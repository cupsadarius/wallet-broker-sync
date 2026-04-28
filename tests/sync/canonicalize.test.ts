import { describe, it, expect } from 'vitest'
import { canonicalContentHash, canonicalNumber, canonicalDate } from '@/src/parsers/canonicalize'

describe('canonicalNumber', () => {
  it('formats with fixed precision', () => {
    expect(canonicalNumber(1234.5, 4)).toBe('1234.5000')
    expect(canonicalNumber(0.1, 6)).toBe('0.100000')
  })
  it('throws on NaN/Infinity', () => {
    expect(() => canonicalNumber(NaN, 2)).toThrow()
    expect(() => canonicalNumber(Infinity, 2)).toThrow()
  })
})

describe('canonicalDate', () => {
  it('normalizes to UTC ms-precision Z-suffixed ISO', () => {
    expect(canonicalDate('2026-04-28T10:09:20.103Z')).toBe('2026-04-28T10:09:20.103Z')
    expect(canonicalDate('2026-04-28T12:09:20.103+02:00')).toBe('2026-04-28T10:09:20.103Z')
  })
})

describe('canonicalContentHash', () => {
  const base = {
    date: '2026-04-28T10:09:20.103Z', exchange: 'XETR', symbol: 'VUAA',
    side: 'buy' as const, quantity: 0.1, price: 25.52, cashAmount: -2.18,
    pricePrecision: 4, quantityPrecision: 6,
  }
  it('is stable across input variations that produce the same canonical form', () => {
    expect(canonicalContentHash(base)).toBe(canonicalContentHash({
      ...base, symbol: 'vuaa', exchange: 'xetr',
      quantity: 0.10000000, price: 25.520,
      date: '2026-04-28T12:09:20.103+02:00',  // same instant
    }))
  })
  it('differs when side, cashAmount, symbol, exchange, date, quantity, or price differ', () => {
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, side: 'sell' }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, cashAmount: -2.19 }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, symbol: 'VUAB' }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, exchange: 'XLON' }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, quantity: 0.2 }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, price: 25.53 }))
  })
  it('different precision parameters produce different hashes when they affect the formatted output', () => {
    expect(canonicalContentHash({ ...base, price: 25.5249, pricePrecision: 2 }))
      .not.toBe(canonicalContentHash({ ...base, price: 25.5249, pricePrecision: 4 }))
  })
})
