import { describe, it, expect } from 'vitest'
import { crossRate } from '@/src/dashboards/compute/fx'

const lookup = (stored: Record<string, number>) => (b: string, q: string) => stored[`${b}/${q}`] ?? null
const direct = lookup({ 'RON/EUR': 0.2, 'USD/EUR': 0.9 })

describe('crossRate', () => {
  it('returns 1 for the same currency', () => {
    expect(crossRate('RON', 'RON', direct, 'EUR')).toBe(1)
  })
  it('uses a stored pair as is', () => {
    expect(crossRate('RON', 'EUR', direct, 'EUR')).toBe(0.2)
  })
  it('inverts a stored pair', () => {
    expect(crossRate('EUR', 'RON', direct, 'EUR')).toBeCloseTo(5)
  })
  it('crosses through the pivot when no pair exists', () => {
    expect(crossRate('USD', 'RON', direct, 'EUR')).toBeCloseTo(4.5)
  })
  it('returns null when no path exists', () => {
    expect(crossRate('GBP', 'RON', direct, 'EUR')).toBeNull()
  })
  it('prefers the path through the pivot over a direct pair that sync no longer updates', () => {
    const rates = lookup({ 'USD/RON': 4.5, 'EUR/RON': 5, 'USD/EUR': 0.8, 'RON/EUR': 0.1, 'GBP/USD': 1.3 })
    expect(crossRate('USD', 'EUR', rates, 'RON')).toBeCloseTo(0.9)
    expect(crossRate('RON', 'EUR', rates, 'RON')).toBeCloseTo(0.2)
    expect(crossRate('EUR', 'USD', rates, 'RON')).toBeCloseTo(1 / 0.9)
    expect(crossRate('GBP', 'USD', rates, 'RON')).toBe(1.3)
  })
})
