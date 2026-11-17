import { describe, it, expect } from 'vitest'
import { accrued, valueAt, payout, comingUp, type Maturity } from '@/src/dashboards/compute/maturities'

const bond: Maturity = {
  id: 1, kind: 'bond', name: 'Fidelis 2027', accountId: null, symbol: 'R2704A', currency: 'RON',
  principal: 1000, rateBps: 700, startDate: '2025-04-17', maturityDate: '2027-04-17',
}
const deposit: Maturity = {
  id: 2, kind: 'deposit', name: 'BT deposit', accountId: 'dep', symbol: null, currency: 'RON',
  principal: 250_000, rateBps: 600, startDate: null, maturityDate: '2027-04-17',
}

describe('bond accrual', () => {
  it('accrues the coupon since the last anniversary of the maturity date', () => {
    // 2026-04-17 → 2026-10-17 = 183 days
    expect(accrued(bond, '2026-10-17')).toBeCloseTo(1000 * 0.07 * 183 / 365, 6)
  })
  it('values the bond at par plus accrued coupon while it runs', () => {
    expect(valueAt(bond, '2026-10-17')).toBeCloseTo(1000 + 35.0959, 3)
  })
  it('values the bond at zero before the start and after maturity', () => {
    expect(valueAt(bond, '2025-01-01')).toBe(0)
    expect(valueAt(bond, '2027-04-17')).toBe(0)
  })
  it('pays principal plus the last coupon at maturity', () => {
    expect(payout(bond)).toBeCloseTo(1070, 6)
  })
})

describe('deposit payout', () => {
  it('assumes a one-year term when no start date is set', () => {
    expect(payout(deposit)).toBeCloseTo(265_000, 6)
  })
  it('is unknown when the rate is not set', () => {
    expect(payout({ ...deposit, rateBps: null })).toBeNull()
    expect(accrued({ ...deposit, rateBps: null }, '2026-10-17')).toBe(0)
  })
})

describe('comingUp', () => {
  it('lists future maturities first, soonest first, then recent ones as done', () => {
    const old = { ...bond, id: 3, name: 'R2604B', maturityDate: '2026-04-16', startDate: '2025-04-14' }
    const ancient = { ...bond, id: 4, maturityDate: '2024-01-01', startDate: '2023-01-01' }
    const later = { ...deposit, id: 5, maturityDate: '2028-01-01' }
    const events = comingUp([later, old, deposit, ancient], '2026-11-17')
    expect(events.map(e => [e.maturity.id, e.done])).toEqual([[2, false], [5, false], [3, true]])
  })
})
