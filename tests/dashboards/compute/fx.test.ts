import { describe, it, expect } from 'vitest'
import { crossRate } from '@/src/dashboards/compute/fx'

// Stored pairs mirror the real fx_history: everything quoted into EUR.
const stored: Record<string, number> = { 'RON/EUR': 0.2, 'USD/EUR': 0.9 }
const direct = (b: string, q: string) => stored[`${b}/${q}`] ?? null

describe('crossRate', () => {
  it('returns 1 for the same currency', () => {
    expect(crossRate('RON', 'RON', direct)).toBe(1)
  })
  it('uses a stored pair as is', () => {
    expect(crossRate('RON', 'EUR', direct)).toBe(0.2)
  })
  it('inverts a stored pair', () => {
    expect(crossRate('EUR', 'RON', direct)).toBeCloseTo(5)
  })
  it('crosses through EUR when no pair exists', () => {
    expect(crossRate('USD', 'RON', direct)).toBeCloseTo(4.5)
  })
  it('returns null when no path exists', () => {
    expect(crossRate('GBP', 'RON', direct)).toBeNull()
  })
})
