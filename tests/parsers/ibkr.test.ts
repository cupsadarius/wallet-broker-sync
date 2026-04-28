import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ibkr } from '@/src/parsers/ibkr'

const fixture = (name: string) => ({
  bytes: new Uint8Array(readFileSync(resolve('tests/parsers/fixtures', name))),
  filename: name,
})

describe('ibkr parser', () => {
  it('detect() accepts IBKR Activity Statement CSV', () => {
    expect(ibkr.detect(fixture('ibkr-2026.csv'))).toBe(true)
  })

  it('parses Buy rows into CanonicalTxn[]', () => {
    const result = ibkr.parse(fixture('ibkr-2026.csv'))
    expect(result.txns.length).toBeGreaterThan(0)
    const buy = result.txns.find(t => t.kind === 'buy')
    expect(buy).toBeTruthy()
    expect(buy!.broker).toBe('ibkr')
    expect(buy!.symbol).toBeTruthy()
    expect(buy!.exchange).toBeTruthy()  // resolved from venue table
    expect(buy!.quantity).toBeGreaterThan(0)
    expect(buy!.pricePerShare).toBeGreaterThan(0)
    expect(buy!.tradeCurrency).toBe('USD')         // most IBKR trades are USD
    expect(buy!.settlementCurrency).toBe('EUR')    // base currency from Summary section
    expect(buy!.cashAmount).toBeLessThan(0)        // buys are outflows
    expect(buy!.externalId).toMatch(/^[0-9a-f]+$/) // content hash
    expect(buy!.date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('routes Forex Trade Component, Dividend, Foreign Tax Withholding, Adjustment to unsupported', () => {
    const result = ibkr.parse(fixture('ibkr-2026.csv'))
    const reasons = result.unsupported.map(u => u.reason)
    expect(reasons.some(r => /Forex Trade Component/i.test(r))).toBe(true)
    expect(reasons.some(r => /Dividend/i.test(r))).toBe(true)
    expect(reasons.some(r => /Foreign Tax Withholding/i.test(r))).toBe(true)
    expect(reasons.some(r => /Adjustment/i.test(r))).toBe(true)
  })

  it('produces stable externalId hash from canonicalized fields (re-parse yields same id)', () => {
    const a = ibkr.parse(fixture('ibkr-2026.csv'))
    const b = ibkr.parse(fixture('ibkr-2026.csv'))
    expect(a.txns.map(t => t.externalId)).toEqual(b.txns.map(t => t.externalId))
  })
})
