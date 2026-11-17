import { describe, it, expect } from 'vitest'
import { findTransferCounterparts, likelyTransfers, pairKey, reviewQueue, unexplainedOutflows } from '@/src/spending/review'
import type { MirrorAccount, MirrorRecord } from '@/src/dashboards/mirror'

function rec(p: Partial<MirrorRecord> & { id: string }): MirrorRecord {
  return {
    accountId: 'bt', amount: 1000, recordType: 1, currencyCode: 'RON', recordDate: '2026-11-10',
    isTradeFallback: false, transfer: false, bankSynced: true, ...p,
  }
}

describe('reviewQueue', () => {
  const records = [
    rec({ id: 'old', recordDate: '2026-11-01', createdAt: '2026-11-02T00:10:00.000+00:00' }),
    rec({ id: 'late', recordDate: '2026-11-01', createdAt: '2026-11-12T00:10:00.000+00:00' }),
    rec({ id: 'new', recordDate: '2026-11-12', createdAt: '2026-11-13T00:10:00.000+00:00' }),
    rec({ id: 'income', recordType: 0, recordDate: '2026-11-11', createdAt: '2026-11-11T08:00:00.000Z' }),
    rec({ id: 'manual', recordDate: '2026-11-09', bankSynced: false }),
    rec({ id: 'transfer', transfer: true, createdAt: '2026-11-13T00:00:00.000Z' }),
    rec({ id: 'fallback', isTradeFallback: true, createdAt: '2026-11-13T00:00:00.000Z' }),
  ]

  it('lists records that reached Wallet after the cursor, newest first, without transfers or trade fallbacks', () => {
    const q = reviewQueue(records, { cursor: '2026-11-05T00:00:00.000Z', accepted: [] })
    expect(q.items.map(r => r.id)).toEqual(['new', 'income', 'manual', 'late'])
    expect(q.upTo).toBe('2026-11-13T00:10:00.000Z')
  })

  it('hides rows accepted one by one, and keeps the cursor when nothing is left', () => {
    const q = reviewQueue(records, { cursor: '2026-11-05T00:00:00.000Z', accepted: ['new', 'income', 'manual', 'late'] })
    expect(q).toEqual({ items: [], upTo: '2026-11-05T00:00:00.000Z' })
  })

  it('moving the cursor to upTo empties the queue until new records arrive', () => {
    const first = reviewQueue(records, { cursor: '2026-11-05T00:00:00.000Z', accepted: [] })
    expect(reviewQueue(records, { cursor: first.upTo, accepted: [] }).items).toEqual([])
    const later = [...records, rec({ id: 'next', createdAt: '2026-11-14T00:00:00.000Z' })]
    expect(reviewQueue(later, { cursor: first.upTo, accepted: [] }).items.map(r => r.id)).toEqual(['next'])
  })
})

describe('unexplainedOutflows', () => {
  const acc = (id: string, provider: string, active: boolean): MirrorAccount => ({
    id, name: id, accountType: 2, currencyCode: 'RON', assetTypes: [], initAmount: 0, archived: false,
    bank: { provider, active },
  })
  const accounts = [acc('bt', 'Banca Transilvania', true), acc('rev', 'Revolut', false), acc('rev-eur', 'Revolut', false)]
  const now = new Date('2026-11-17T12:00:00Z')
  const topUp = (id: string, recordDate: string, amount = 200_000) =>
    rec({ id, recordDate, amount, transfer: true, note: `EPOS ${recordDate} TID: Revolut**2222* 70 SI` })

  it('sums large outflows to a provider whose sync is stale, since it went stale and within 6 weeks', () => {
    const out = unexplainedOutflows(accounts, [
      rec({ id: 'last-sync', accountId: 'rev', recordDate: '2026-10-24' }),
      topUp('t1', '2026-11-01', 490_000),
      topUp('t2', '2026-10-26'),
      rec({ id: 'linked', recordDate: '2026-10-30', amount: 50_000, transfer: true, transferAccountId: 'rev-eur' }),
      topUp('before-stale', '2026-10-20'),
      rec({ id: 'fee', recordDate: '2026-10-30', amount: 2_000, note: 'Comision Revolut3333' }),
      rec({ id: 'incoming', recordDate: '2026-10-30', recordType: 0, amount: 90_000, note: 'Revolut' }),
      rec({ id: 'spend-on-rev', accountId: 'rev', recordDate: '2026-11-02', amount: 90_000, note: 'Revolut', bankSynced: false }),
    ], now)
    expect(out).toEqual([{
      provider: 'Revolut', staleSince: '2026-10-24', since: '2026-10-24',
      records: [expect.objectContaining({ id: 't1' }), expect.objectContaining({ id: 'linked' }), expect.objectContaining({ id: 't2' })],
    }])
  })

  it('looks back at most 6 weeks, and stays quiet for active syncs or no outflows', () => {
    const records = [rec({ id: 'last-sync', accountId: 'rev', recordDate: '2026-08-27' }), topUp('old', '2026-09-20'), topUp('t', '2026-10-10')]
    expect(unexplainedOutflows(accounts, records, now)[0]).toMatchObject({ staleSince: '2026-08-27', since: '2026-10-06' })
    expect(unexplainedOutflows(accounts, records, now)[0].records.map(r => r.id)).toEqual(['t'])
    expect(unexplainedOutflows([acc('bt', 'Banca Transilvania', true)], records, now)).toEqual([])
    expect(unexplainedOutflows(accounts, records.slice(0, 2), now)).toEqual([])
  })
})

describe('findTransferCounterparts', () => {
  const topUp = rec({ id: 'topup', accountId: 'r-joint', recordType: 0, amount: 490_000, recordDate: '2026-10-30', note: 'Top-Up by *1111' })
  const out = (id: string, p: Partial<MirrorRecord> = {}) =>
    rec({ id, accountId: 'bt', recordType: 1, amount: 490_000, recordDate: '2026-10-29', payee: 'Revolut', ...p })

  it('finds the opposite record in another account with the same amount and currency, nearest date first', () => {
    const records = [
      topUp,
      out('far', { recordDate: '2026-11-03' }),
      out('near'),
      out('edge-before', { recordDate: '2026-10-26' }),
      out('too-late', { recordDate: '2026-11-07' }),
      out('same-account', { accountId: 'r-joint' }),
      out('same-direction', { recordType: 0 }),
      out('other-amount', { amount: 480_000 }),
      out('other-currency', { currencyCode: 'EUR' }),
      out('already-transfer', { transfer: true, transferAccountId: 'savings' }),
      out('transfer-category', { categoryName: 'Transfer' }),
      out('trade', { isTradeFallback: true }),
    ]
    expect(findTransferCounterparts(topUp, records).map(r => r.id)).toEqual(['near', 'far', 'edge-before'])
  })

  it('accepts a one-sided transfer as the other side, but not one already paired', () => {
    const records = [
      topUp,
      out('one-sided', { transfer: true, transferId: 'solo', transferAccountId: 'r-joint' }),
      out('paired', { transfer: true, transferId: 'pair' }),
      rec({ id: 'pair-other-leg', accountId: 'savings', recordType: 0, amount: 490_000, recordDate: '2026-10-29', transfer: true, transferId: 'pair' }),
    ]
    expect(findTransferCounterparts(topUp, records).map(r => r.id)).toEqual(['one-sided'])
  })

  it('accepts a transfer leg with no transferId, and ranks by the card date in the note', () => {
    const records = [
      topUp,
      out('posted-late', { recordDate: '2026-11-01', transfer: true, transferAccountId: 'r-joint', note: 'Plata la POS;EPOS 30/10/2026 000000136 TID: Revolut**7' }),
      out('same-day-other', { recordDate: '2026-10-31' }),
    ]
    expect(findTransferCounterparts(topUp, records).map(r => r.id)).toEqual(['posted-late', 'same-day-other'])
  })

  it('works from the outgoing side too', () => {
    const sent = out('sent')
    expect(findTransferCounterparts(sent, [sent, topUp]).map(r => r.id)).toEqual(['topup'])
  })
})

describe('likelyTransfers', () => {
  const inc = (id: string, p: Partial<MirrorRecord> = {}) =>
    rec({ id, accountId: 'r-joint', recordType: 0, amount: 490_000, recordDate: '2026-10-30', ...p })
  const exp = (id: string, p: Partial<MirrorRecord> = {}) =>
    rec({ id, accountId: 'bt', recordType: 1, amount: 490_000, recordDate: '2026-11-01', ...p })
  const today = '2026-11-17'

  it('lists each pair within a week once', () => {
    const out = likelyTransfers([inc('in'), exp('out', { recordDate: '2026-11-06' })], today, new Set())
    expect(out.map(t => [t.record.id, t.candidates.map(c => c.id)])).toEqual([['out', ['in']]])
  })

  it('keeps every candidate when a record has more than one', () => {
    const out = likelyTransfers([inc('in'), exp('a'), exp('b', { accountId: 'savings', recordDate: '2026-10-29' })], today, new Set())
    expect(out).toHaveLength(1)
    expect(out[0].candidates.map(c => c.id).sort()).toEqual(['a', 'b'])
  })

  it('gives a shared leg to the record nearest its card date', () => {
    const leg = exp('leg', { recordDate: '2026-10-03', transfer: true, note: 'EPOS 01/10/2026 TID: Revolut' })
    const out = likelyTransfers([inc('first', { recordDate: '2026-10-01' }), inc('later', { recordDate: '2026-10-08' }), leg], today, new Set())
    expect(out.map(t => [t.record.id, t.candidates.map(c => c.id)])).toEqual([['first', ['leg']]])
  })

  it('hides dismissed pairs and records older than 90 days', () => {
    expect(likelyTransfers([inc('in'), exp('out')], today, new Set([pairKey('out', 'in')]))).toEqual([])
    expect(likelyTransfers([inc('in', { recordDate: '2026-08-01' }), exp('out', { recordDate: '2026-08-02' })], today, new Set())).toEqual([])
  })
})
