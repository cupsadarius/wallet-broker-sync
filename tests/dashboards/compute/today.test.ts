import { describe, it, expect } from 'vitest'
import { accountBalances, uploadTasks, bankTasks, maturityTasks, dataAge, nextUnlock, staleTasks } from '@/src/dashboards/compute/today'
import { monthEndSamples } from '@/src/dashboards/compute/networth'
import type { MirrorAccount, MirrorRecord } from '@/src/dashboards/mirror'
import type { Maturity } from '@/src/dashboards/compute/maturities'

const XTB = 'acc-xtb'
const BANK = 'acc-bank'

function rec(p: Partial<MirrorRecord> & { id: string; recordDate: string }): MirrorRecord {
  return {
    accountId: BANK, amount: 10_000, recordType: 1, currencyCode: 'EUR',
    isTradeFallback: false, transfer: false, bankSynced: true, ...p,
  }
}
function acc(p: Partial<MirrorAccount> & { id: string }): MirrorAccount {
  return { name: p.id, accountType: 2, currencyCode: 'RON', assetTypes: [], initAmount: 0, archived: false, ...p }
}

const brokers = [{ broker: 'xtb' as const, accountId: XTB }]

describe('uploadTasks', () => {
  const base = { brokers, transactions: [{ accountId: XTB, date: '2026-07-20' }], lastImport: {} }

  it('asks for a statement when a bank transfer to the broker is newer than its activity', () => {
    const tasks = uploadTasks({
      ...base,
      records: [rec({ id: 'r1', recordDate: '2026-08-31', transfer: true, payee: 'XTB S.A, DE91' })],
    })
    expect(tasks).toEqual([{
      id: 'upload:xtb:r1', kind: 'upload', title: 'Upload XTB statement',
      detail: 'Transfer of 100 EUR on 31 Aug 2026. No newer XTB activity imported.',
      href: '/upload?broker=xtb', action: 'Upload',
    }])
  })

  it('accepts a synced transfer recorded on the broker account itself', () => {
    const tasks = uploadTasks({
      ...base,
      records: [rec({ id: 'r2', accountId: XTB, recordType: 0, transfer: true, recordDate: '2026-08-01' })],
    })
    expect(tasks.map(t => t.id)).toEqual(['upload:xtb:r2'])
  })

  it('stays quiet when a trade, a fallback record, or an import is as new as the transfer', () => {
    const records = [rec({ id: 'r1', recordDate: '2026-08-31', transferAccountId: XTB, transfer: true })]
    expect(uploadTasks({ ...base, records, transactions: [{ accountId: XTB, date: '2026-08-31' }] })).toEqual([])
    expect(uploadTasks({ ...base, records: [...records, rec({ id: 'f', accountId: XTB, isTradeFallback: true, bankSynced: false, recordDate: '2026-09-01' })] })).toEqual([])
    expect(uploadTasks({ ...base, records, lastImport: { xtb: '2026-09-02' } })).toEqual([])
  })

  it('ignores manual records, incoming money from the broker, and other payees', () => {
    const records = [
      rec({ id: 'm', recordDate: '2026-08-31', payee: 'XTB', bankSynced: false }),
      rec({ id: 'w', recordDate: '2026-08-31', payee: 'XTB', recordType: 0 }),
      rec({ id: 'o', recordDate: '2026-08-31', payee: 'Lidl' }),
    ]
    expect(uploadTasks({ ...base, records })).toEqual([])
  })

  it('makes one task per broker for the newest transfer', () => {
    const records = [
      rec({ id: 'a', recordDate: '2026-08-01', payee: 'XTB S.A' }),
      rec({ id: 'b', recordDate: '2026-09-01', payee: 'XTB S.A' }),
    ]
    expect(uploadTasks({ ...base, records }).map(t => t.id)).toEqual(['upload:xtb:b'])
  })
})

describe('accountBalances', () => {
  it('adds income and subtracts expenses on top of the opening balance, up to a date', () => {
    const accounts = [acc({ id: BANK, initAmount: 50_00 })]
    const records = [
      rec({ id: '1', recordType: 0, amount: 100_00, recordDate: '2026-01-01' }),
      rec({ id: '2', recordType: 1, amount: 30_00, recordDate: '2026-02-01' }),
      rec({ id: '3', recordType: 0, amount: 999_00, recordDate: '2026-03-01' }),
    ]
    expect(accountBalances(accounts, records, '2026-02-15').get(BANK)).toBe(120)
  })
})

describe('bankTasks', () => {
  it('asks to reconnect a bank whose sync stopped', () => {
    const accounts = [
      acc({ id: 'r1', bank: { provider: 'Revolut', active: false } }),
      acc({ id: 'r2', bank: { provider: 'Revolut', active: false } }),
      acc({ id: 'bt', bank: { provider: 'Banca Transilvania', active: true, lastRefresh: '2026-11-17T00:00:00Z' } }),
    ]
    const records = [rec({ id: 'x', accountId: 'r2', recordDate: '2026-08-27' })]
    expect(bankTasks(accounts, records)).toEqual([{
      id: 'bank:Revolut', kind: 'bank', title: 'Reconnect Revolut',
      detail: 'Bank sync stopped. Newest data 27 Aug 2026. Reconnect it in the Wallet app.',
    }])
  })
})

describe('maturityTasks', () => {
  const m: Maturity = {
    id: 7, kind: 'deposit', name: 'BT deposit', accountId: null, symbol: null, currency: 'RON',
    principal: 250_000, rateBps: null, startDate: null, maturityDate: '2026-11-25',
  }
  it('flags a maturity in the next 14 days', () => {
    expect(maturityTasks([m], '2026-11-17').map(t => t.id)).toEqual(['maturity:7'])
    expect(maturityTasks([m], '2026-11-01')).toEqual([])
    expect(maturityTasks([m], '2026-11-26')).toEqual([])
  })
})

describe('dataAge', () => {
  it('marks each source stale past its threshold', () => {
    const now = new Date('2026-11-17T12:00:00Z')
    const entries = dataAge({
      accounts: [
        acc({ id: 'bt', bank: { provider: 'BT', active: true, lastRefresh: '2026-11-17T00:16:00Z' } }),
        acc({ id: 'rv', bank: { provider: 'Revolut', active: false } }),
      ],
      records: [rec({ id: 'x', accountId: 'rv', recordDate: '2026-10-24' })],
      lastImport: { xtb: '2026-11-17T10:00:00Z', ibkr: '2026-08-01T10:00:00Z' },
      pricesAsOf: '2026-05-11',
      mirrorAsOf: '2026-11-17T11:58:00Z',
      now,
    })
    expect(entries.map(e => [e.label, e.asOf?.slice(0, 10) ?? null, e.stale])).toEqual([
      ['Wallet', '2026-11-17', false],
      ['BT', '2026-11-17', false],
      ['Revolut', '2026-10-24', true],
      ['XTB', '2026-11-17', false],
      ['IBKR', '2026-08-01', true],
      ['Tradeville', null, true],
      ['Prices', '2026-05-11', true],
    ])
  })
})

describe('monthEndSamples', () => {
  it('samples each month end from the start month and ends on the end day', () => {
    expect(monthEndSamples('2026-01-15', new Date('2026-03-10'))).toEqual(['2026-01-31', '2026-02-28', '2026-03-10'])
  })
})

describe('nextUnlock', () => {
  const accounts = [
    { id: 'p3', name: 'Pilon 3', releaseDate: '2041-01-10', locked: true },
    { id: 'p2', name: 'Pilon 2', releaseDate: '2051-03-03', locked: true },
    { id: 'old', name: 'Old policy', releaseDate: '2020-01-01', locked: false },
    { id: 'none', name: 'No date', releaseDate: null, locked: true },
  ]
  const projected = new Map([['p3', { date: '2041-01-10', value: 3_330_000 }], ['p2', { date: '2051-03-03', value: 9_000_000 }]])
  it('is the earliest future unlock with its projected value', () => {
    expect(nextUnlock(accounts, projected, '2026-11-18')).toEqual({ name: 'Pilon 3', date: '2041-01-10', value: 3_330_000 })
  })
  it('is null when no unlock date is in the future', () => {
    expect(nextUnlock(accounts, projected, '2060-01-01')).toBeNull()
  })
})

describe('staleTasks', () => {
  const now = new Date('2026-11-18T10:00:00Z')
  const age = [
    { label: 'XTB', asOf: '2026-10-15T00:00:00Z', stale: true },
    { label: 'IBKR', asOf: '2026-11-10T00:00:00Z', stale: false },
    { label: 'BT', asOf: '2026-11-01', stale: true },
    { label: 'Prices', asOf: null, stale: true },
  ]
  it('asks for a statement when a broker is old, and names other old sources', () => {
    const tasks = staleTasks(age, new Set(['BT']), now)
    expect(tasks.map(t => t.title)).toEqual(['XTB statement is 34 days old', 'No Prices data yet'])
    expect(tasks[0]).toMatchObject({ href: '/upload?broker=xtb', action: 'Upload' })
  })
})
