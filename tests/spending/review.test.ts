import { describe, it, expect } from 'vitest'
import { reviewQueue, unexplainedOutflows } from '@/src/spending/review'
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
    rec({ id, recordDate, amount, transfer: true, note: `EPOS ${recordDate} TID: Revolut**4794* 70 SI` })

  it('sums large outflows to a provider whose sync is stale, since it went stale and within 6 weeks', () => {
    const out = unexplainedOutflows(accounts, [
      rec({ id: 'last-sync', accountId: 'rev', recordDate: '2026-10-24' }),
      topUp('t1', '2026-11-01', 490_000),
      topUp('t2', '2026-10-26'),
      rec({ id: 'linked', recordDate: '2026-10-30', amount: 50_000, transfer: true, transferAccountId: 'rev-eur' }),
      topUp('before-stale', '2026-10-20'),
      rec({ id: 'fee', recordDate: '2026-10-30', amount: 2_000, note: 'Comision Revolut7723' }),
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
