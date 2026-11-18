import { describe, it, expect } from 'vitest'
import { retirementTasks, summarize, type SummaryInput } from '@/src/retirement/compute'

type Account = SummaryInput['accounts'][number]
type Stmt = SummaryInput['statements'][number]

const account = (p: Partial<Account> & { id: string }): Account => ({
  kind: 'pilon2', provider: 'bt-pensia-noastra', product: 'Pensia Noastră', contract: 'ABC/1', currency: 'RON',
  releaseDate: '2050-01-01', yearlyContribution: null, createdAt: '2026-01-01T00:00:00Z', ...p,
})
let n = 0
const stmt = (p: Partial<Stmt> & { accountId: string; asOf: string }): Stmt => ({
  id: ++n, value: null, paidIn: null, fees: null, details: null, fileHash: `h${n}`, uploadedAt: '2026-01-01T00:00:00Z', ...p,
})
const input = (p: Partial<SummaryInput>): SummaryInput => ({
  base: 'RON', accounts: [], statements: [], contributions: [], fx: () => null, today: '2026-01-10', vpr: 8100, ...p,
})

describe('yearly return', () => {
  it('uses every contribution when the statement has the history', () => {
    const s = summarize(input({
      accounts: [account({ id: 'a' })],
      statements: [stmt({ accountId: 'a', asOf: '2026-01-01', value: 11000, paidIn: 10000, fees: 0 })],
      contributions: [{ accountId: 'a', date: '2025-01-01', gross: 10000, fee: 0 }],
    }))
    expect(s.accounts[0].yearly).toMatchObject({ basis: 'contributions', since: '2025-01-01', months: 12 })
    expect(s.accounts[0].yearly!.rate).toBeCloseTo(0.1, 3)
  })

  it('uses the snapshots since the first one when there is no history', () => {
    const s = summarize(input({
      accounts: [account({ id: 'p', kind: 'unit-linked', releaseDate: null })],
      statements: [
        stmt({ accountId: 'p', asOf: '2025-01-01', value: 100000, paidIn: 90000 }),
        stmt({ accountId: 'p', asOf: '2025-07-01', value: 110000, paidIn: 100000 }),
        stmt({ accountId: 'p', asOf: '2026-01-01', value: 121000, paidIn: 100000 }),
      ],
    }))
    expect(s.accounts[0].yearly).toMatchObject({ basis: 'statements', since: '2025-01-01' })
    expect(s.accounts[0].yearly!.rate).toBeCloseTo(0.105, 2)
    expect(s.accounts[0]).toMatchObject({ value: 121000, paidIn: 100000, gain: 21000 })
  })

  it('gives no yearly return for one snapshot, only the gain percent', () => {
    const s = summarize(input({
      accounts: [account({ id: 'p', kind: 'unit-linked' })],
      statements: [stmt({ accountId: 'p', asOf: '2026-01-01', value: 15000, paidIn: 10000 })],
    }))
    expect(s.accounts[0].yearly).toBeNull()
    expect(s.accounts[0].gainPct).toBeCloseTo(0.5)
  })
})

describe('locked and available', () => {
  const two = (releaseDate: string | null) => input({
    accounts: [account({ id: 'a', releaseDate }), account({ id: 'b', releaseDate: '2050-01-01' })],
    statements: [
      stmt({ accountId: 'a', asOf: '2026-01-01', value: 1000, paidIn: 800 }),
      stmt({ accountId: 'b', asOf: '2026-01-01', value: 5000, paidIn: 4000 }),
    ],
  })

  it('moves an account to available on its release date, never both', () => {
    const s = summarize(two('2026-01-10'))
    expect(s).toMatchObject({ locked: 5000, available: 1000, paidInLocked: 4000 })
    expect(s.accounts.find(a => a.id === 'a')!.locked).toBe(false)
  })

  it('counts an account with no release date as locked', () => {
    expect(summarize(two(null))).toMatchObject({ locked: 6000, available: 0 })
  })

  it('leaves an EUR account out of the totals when there is no FX rate, and names it', () => {
    const eur = (fx: SummaryInput['fx']) => summarize(input({
      fx,
      accounts: [account({ id: 'e', kind: 'unit-linked', currency: 'EUR', releaseDate: null })],
      statements: [stmt({ accountId: 'e', asOf: '2026-01-01', value: 1000, paidIn: 800 })],
    }))
    expect(eur(() => null)).toMatchObject({ locked: 0, unconverted: ['e'] })
    expect(eur(() => null).accounts[0].valueBase).toBeNull()
    expect(eur(c => (c === 'EUR' ? 5 : null))).toMatchObject({ locked: 5000, paidInLocked: 4000, unconverted: [] })
  })
})

describe('staleness, Pilon 1 and tasks', () => {
  const s = summarize(input({
    today: '2026-12-01',
    accounts: [
      account({ id: 'fresh' }), account({ id: 'old', provider: 'signal-iduna', kind: 'unit-linked' }),
      account({ id: 'cnpp', kind: 'pilon1', provider: 'cnpp', product: 'Pilon 1', contract: '', releaseDate: null }),
    ],
    statements: [
      stmt({ accountId: 'fresh', asOf: '2026-09-02', value: 1, paidIn: 1 }),
      stmt({ accountId: 'old', asOf: '2026-09-01', value: 1, paidIn: 1 }),
      stmt({ accountId: 'cnpp', asOf: '2025-12-01', details: {
        period: { years: 6, months: 2, days: 10 }, points: 10, pointsByYear: [{ year: 2025, points: 4 }, { year: 2026, points: 6 }],
      } }),
    ],
  }))

  it('marks a statement stale after 90 days, and Pilon 1 after 365 days', () => {
    expect(s.accounts.map(a => [a.id, a.stale])).toEqual([['fresh', false], ['old', true]])
    expect(s.pilon1!.stale).toBe(false)
  })

  it('estimates the pension as points × VPR and reads this year\'s points', () => {
    expect(s.pilon1).toMatchObject({ points: 10, pointsThisYear: 6, vpr: 8100, pensionEstimate: 81000 })
  })

  it('makes one upload task per stale account', () => {
    expect(retirementTasks(s)).toEqual([expect.objectContaining({
      id: 'retirement:old:2026-09-01', kind: 'retirement', title: 'Upload Signal Iduna statement', href: '/upload',
    })])
  })
})

describe('account history', () => {
  it('groups contributions by year and lists statements, newest first', () => {
    const s = summarize(input({
      accounts: [account({ id: 'a' })],
      statements: [
        stmt({ accountId: 'a', asOf: '2025-06-30', value: 9000, paidIn: 8000, fees: 100 }),
        stmt({ accountId: 'a', asOf: '2026-01-01', value: 11000, paidIn: 10000, fees: 150 }),
      ],
      contributions: [
        { accountId: 'a', date: '2025-03-15', gross: 3000, fee: 30 },
        { accountId: 'a', date: '2024-12-15', gross: 5000, fee: 50 },
        { accountId: 'a', date: '2025-01-15', gross: 2000, fee: 20 },
        { accountId: 'b', date: '2025-01-15', gross: 9999, fee: 0 },
      ],
    }))
    expect(s.accounts[0].contributionsByYear).toEqual([
      { year: 2025, gross: 5000, fee: 50, items: [
        { date: '2025-03-15', gross: 3000, fee: 30 }, { date: '2025-01-15', gross: 2000, fee: 20 },
      ] },
      { year: 2024, gross: 5000, fee: 50, items: [{ date: '2024-12-15', gross: 5000, fee: 50 }] },
    ])
    expect(s.accounts[0].statements).toEqual([
      { asOf: '2026-01-01', value: 11000, paidIn: 10000, fees: 150 },
      { asOf: '2025-06-30', value: 9000, paidIn: 8000, fees: 100 },
    ])
  })
})
