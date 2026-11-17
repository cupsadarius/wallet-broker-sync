import { describe, it, expect } from 'vitest'
import { magicRuleDoc, patchDocs, writeRule, type Doc } from '@/src/spending/write'
import type { BulkDocResult } from '@/src/sync/couch'

const NOW = '2026-11-17T10:00:00.000Z'

/** In-memory Couch: a write wins only when it carries the stored `_rev`. */
function fakeCouch(stored: Doc[]) {
  const docs = new Map(stored.map(d => [d._id, d]))
  const bulkCalls: Doc[][] = []
  return {
    docs, bulkCalls,
    bump(id: string, change: Record<string, unknown>) {
      const d = docs.get(id)!
      docs.set(id, { ...d, ...change, _rev: `${Number(String(d._rev).split('-')[0]) + 1}-other` })
    },
    async bulkDocs(batch: Array<Record<string, unknown>>): Promise<BulkDocResult[]> {
      bulkCalls.push(batch as Doc[])
      return batch.map(raw => {
        const d = raw as Doc
        const cur = docs.get(d._id)
        if (cur ? cur._rev !== d._rev : d._rev !== undefined) return { id: d._id, status: 'conflict' }
        const rev = `${cur ? Number(String(cur._rev).split('-')[0]) + 1 : 1}-ok`
        docs.set(d._id, { ...d, _rev: rev })
        return { id: d._id, status: 'inserted', rev }
      })
    },
    async getDoc(id: string) { return docs.get(id) ?? null },
  }
}

const record = (id: string): Doc => ({ _id: id, _rev: '1-a', reservedModelType: 'Record', categoryId: '-Category_old', note: id })

describe('patchDocs', () => {
  it('writes each doc with its _rev and returns the new revisions', async () => {
    const couch = fakeCouch([record('Record_a')])
    const out = await patchDocs(couch, [record('Record_a')], { categoryId: '-Category_new' }, NOW)
    expect(out.failed).toEqual([])
    expect(out.written).toEqual([{ ...record('Record_a'), categoryId: '-Category_new', reservedUpdatedAt: NOW, _rev: '2-ok' }])
    expect(couch.bulkCalls[0][0]._rev).toBe('1-a')
  })

  it('on a conflict re-reads the doc and retries once, keeping the other change', async () => {
    const couch = fakeCouch([record('Record_a'), record('Record_b')])
    couch.bump('Record_b', { note: 'edited in the app' })
    const out = await patchDocs(couch, [record('Record_a'), record('Record_b')], { categoryId: '-Category_new' }, NOW)
    expect(out.failed).toEqual([])
    expect(out.written.map(d => d._id)).toEqual(['Record_a', 'Record_b'])
    expect(couch.docs.get('Record_b')).toMatchObject({ categoryId: '-Category_new', note: 'edited in the app', _rev: '3-ok' })
    expect(couch.bulkCalls).toHaveLength(2)
    expect(couch.bulkCalls[1].map(d => d._id)).toEqual(['Record_b'])
  })

  it('gives up after one retry and reports the doc as failed', async () => {
    const couch = fakeCouch([record('Record_a')])
    couch.bump('Record_a', {})
    const getDoc = couch.getDoc
    couch.getDoc = async id => { const d = await getDoc(id); couch.bump(id, {}); return d }
    const out = await patchDocs(couch, [record('Record_a')], { categoryId: '-Category_new' }, NOW)
    expect(out).toEqual({ written: [], failed: ['Record_a'] })
    expect(couch.bulkCalls).toHaveLength(2)
  })

  it('reports a doc that is gone on re-read as failed', async () => {
    const couch = fakeCouch([])
    couch.docs.set('Record_a', { ...record('Record_a'), _rev: '2-x' })
    couch.getDoc = async () => null
    expect(await patchDocs(couch, [record('Record_a')], { categoryId: '-Category_new' }, NOW))
      .toEqual({ written: [], failed: ['Record_a'] })
  })
})

describe('patchDocs with a patch built from each doc', () => {
  it('rebuilds the patch from the fresh doc on a conflict, so a budget limit change keeps the other change', async () => {
    const budget: Doc = { _id: '-Budget_a', _rev: '1-a', reservedModelType: 'Budget', name: 'Car', amount: 60_000, changes: [] }
    const couch = fakeCouch([budget])
    couch.bump('-Budget_a', { name: 'Car and fuel', changes: [{ amount: 70_000, date: '2025-01-05T00:00:00.000Z' }] })
    const patch = (d: Doc) => ({ changes: [...(d.changes as unknown[]), { amount: 65_000, date: NOW }] })
    const out = await patchDocs(couch, [budget], patch, NOW)
    expect(out.failed).toEqual([])
    expect(couch.docs.get('-Budget_a')).toMatchObject({
      name: 'Car and fuel', amount: 60_000,
      changes: [{ amount: 70_000, date: '2025-01-05T00:00:00.000Z' }, { amount: 65_000, date: NOW }],
    })
  })
})

describe('magicRuleDoc and writeRule', () => {
  const rule = magicRuleDoc({ name: 'Leroy', keywords: ['Leroy Merlin'], categoryId: '-Category_home' }, 'owner-1', NOW)

  it('builds a Wallet MagicRule with a deterministic id and the reserved fields', () => {
    expect(rule).toEqual({
      _id: expect.stringMatching(/^-MagicRule_/),
      reservedModelType: 'MagicRule', reservedSource: 'wallet-broker-sync',
      reservedOwnerId: 'owner-1', reservedAuthorId: 'owner-1', reservedCreatedAt: NOW, reservedUpdatedAt: NOW,
      name: 'Leroy', keywords: ['Leroy Merlin'], categoryId: '-Category_home', recordType: 1, sendPushNotification: false,
    })
  })

  it('writes the rule once; a retry finds it and does not duplicate it', async () => {
    const couch = fakeCouch([])
    expect(await writeRule(couch, rule)).toMatchObject({ _id: rule._id, _rev: '1-ok' })
    expect(await writeRule(couch, rule)).toMatchObject({ _id: rule._id, _rev: '1-ok' })
    expect(couch.docs.size).toBe(1)
  })
})
