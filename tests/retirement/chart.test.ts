import { describe, it, expect } from 'vitest'
import { accountTimeline, defaultYearlyContribution, retirementTimeline } from '@/src/retirement/chart'
import type { AccountView } from '@/src/retirement/compute'

const view = (p: Partial<AccountView>): AccountView => ({
  id: 'a', kind: 'pilon2', provider: 'bt-pensia-noastra', product: 'P', contract: 'C', currency: 'RON',
  asOf: '2026-01-15', stale: false, value: 100_000, paidIn: 100_000, gain: 0, fees: null,
  valueBase: 100_000, paidInBase: 100_000, yearly: null, gainPct: 0, releaseDate: null, locked: true,
  contributionsByYear: [], statements: [], ...p,
})
const year = (y: number, items: { date: string; gross: number }[]) =>
  ({ year: y, gross: items.reduce((n, i) => n + i.gross, 0), fee: 0, items: items.map(i => ({ ...i, fee: 0 })) })

describe('defaultYearlyContribution', () => {
  it('sums the contributions of the 12 months before the statement', () => {
    const a = view({ contributionsByYear: [
      year(2026, [{ date: '2026-01-10', gross: 500 }]),
      year(2025, [{ date: '2025-06-10', gross: 300 }]),
      year(2024, [{ date: '2024-12-10', gross: 999 }]),
    ] })
    expect(defaultYearlyContribution(a)).toBe(800)
  })

  it('scales the paid-in rise since the statement about a year earlier to a full year', () => {
    const a = view({ contributionsByYear: [], statements: [
      { asOf: '2026-01-15', value: 0, paidIn: 3000, fees: null },
      { asOf: '2025-07-15', value: 0, paidIn: 2500, fees: null },
      { asOf: '2025-01-15', value: 0, paidIn: 2000, fees: null },
    ] })
    expect(defaultYearlyContribution(a)).toBe(1000)
  })

  it('is 0 without contributions or an earlier statement', () => {
    expect(defaultYearlyContribution(view({ statements: [{ asOf: '2026-01-15', value: 1, paidIn: 1, fees: null }] }))).toBe(0)
  })
})

describe('accountTimeline', () => {
  it('grows the contributions at the account rate and ends on the statement', () => {
    const a = view({
      asOf: '2025-12-31', value: 2200, paidIn: 2000, yearly: { rate: 0.1, basis: 'contributions', since: '2025-01-01', months: 11 },
      contributionsByYear: [year(2025, [{ date: '2025-06-01', gross: 1000 }, { date: '2025-01-01', gross: 1000 }])],
    })
    const t = accountTimeline(a, { rate: 0.05, contribution: 0, until: null })
    expect([...t.keys()][0]).toBe('2025-01')
    expect(t.get('2025-03')!.paidIn).toBe(1000)
    expect(t.get('2025-03')!.value).toBeGreaterThan(1000)
    expect(t.get('2025-06')!.paidIn).toBe(2000)
    expect(t.get('2025-12')).toEqual({ value: 2200, paidIn: 2000 })
    expect(t.has('2026-01')).toBe(false)
  })

  it('reads policy history from statements, in between by straight line', () => {
    const a = view({ kind: 'unit-linked', asOf: '2025-07-15', value: 160, paidIn: 150, statements: [
      { asOf: '2025-07-15', value: 160, paidIn: 150, fees: null },
      { asOf: '2025-01-15', value: 100, paidIn: 100, fees: null },
    ] })
    const t = accountTimeline(a, { rate: 0.05, contribution: 0, until: null })
    expect(t.get('2025-01')).toEqual({ value: 100, paidIn: 100 })
    expect(t.get('2025-04')!.value).toBeGreaterThan(100)
    expect(t.get('2025-04')!.value).toBeLessThan(160)
    expect(t.get('2025-07')).toEqual({ value: 160, paidIn: 150 })
    expect(t.has('2024-12')).toBe(false)
  })

  it('projects month by month to the unlock date with the yearly contribution', () => {
    const a = view({ asOf: '2026-01-15', value: 10_000, paidIn: 8000, statements: [{ asOf: '2026-01-15', value: 10_000, paidIn: 8000, fees: null }] })
    const flat = accountTimeline(a, { rate: 0, contribution: 1200, until: '2027-01-15' })
    expect(flat.get('2027-01')).toEqual({ value: 11_200, paidIn: 9200 })
    expect(flat.has('2027-02')).toBe(false)
    const grow = accountTimeline(a, { rate: 0.1, contribution: 0, until: '2027-01-15' })
    expect(grow.get('2027-01')!.value).toBeCloseTo(11_000, 6)
  })
})

describe('retirementTimeline', () => {
  it('adds accounts in the base currency, holds a released account flat, and splits history from projection at today', () => {
    const ron = view({ id: 'r', asOf: '2026-01-15', value: 1000, paidIn: 1000, valueBase: 1000, releaseDate: '2026-03-15',
      statements: [{ asOf: '2026-01-15', value: 1000, paidIn: 1000, fees: null }] })
    const eur = view({ id: 'e', currency: 'EUR', asOf: '2026-01-15', value: 100, paidIn: 100, valueBase: 500, releaseDate: '2026-05-15',
      statements: [{ asOf: '2026-01-15', value: 100, paidIn: 100, fees: null }] })
    const t = retirementTimeline([ron, eur], { rate: 0, contributions: new Map([['r', 120], ['e', 0]]), today: '2026-02-10' })
    expect(t.points.map(p => p.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'])
    expect(t.points[0]).toEqual({ month: '2026-01', value: 1500, projected: null, paidIn: 1500 })
    expect(t.points[1]).toMatchObject({ month: '2026-02', value: 1510, projected: 1510 })
    expect(t.points[4]).toEqual({ month: '2026-05', value: null, projected: 1520, paidIn: 1520 })
    expect(t.final).toEqual({ month: '2026-05', value: 1520, paidIn: 1520 })
    expect(t.atRelease.get('r')).toEqual({ date: '2026-03-15', value: 1020, paidIn: 1020 })
  })

  it('projects an account without an unlock date to the latest unlock date of the others', () => {
    const a = view({ id: 'a', releaseDate: '2026-03-15', statements: [{ asOf: '2026-01-15', value: 100_000, paidIn: 100_000, fees: null }] })
    const b = view({ id: 'b', releaseDate: null, statements: [{ asOf: '2026-01-15', value: 100_000, paidIn: 100_000, fees: null }] })
    const t = retirementTimeline([a, b], { rate: 0, contributions: new Map(), today: '2026-01-20' })
    expect(t.atRelease.get('b')?.date).toBe('2026-03-15')
  })
})
