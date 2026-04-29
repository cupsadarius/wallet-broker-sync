import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ibkr } from '@/src/parsers/ibkr'

const fixture = (name: string) => ({
  bytes: new Uint8Array(readFileSync(resolve('tests/parsers/fixtures', name))),
  filename: name,
})

describe('ibkr parser — yearly Activity Statement format', () => {
  it('detect() accepts the yearly format', () => {
    expect(ibkr.detect(fixture('ibkr-yearly-2025.csv'))).toBe(true)
  })

  it('parses Trades section (signed Quantity → buy/sell direction)', async () => {
    const result = await ibkr.parse(fixture('ibkr-yearly-2025.csv'))
    const buys = result.txns.filter(t => t.kind === 'buy' && t.pricePerShare !== 0)
    expect(buys.length).toBeGreaterThan(0)
  })

  it('parses Corporate Actions split as kind:buy with price 0', async () => {
    const result = await ibkr.parse(fixture('ibkr-yearly-2025.csv'))
    const splits = result.txns.filter(t => t.pricePerShare === 0 && t.kind === 'buy')
    expect(splits.length).toBeGreaterThan(0)
    const nflxSplit = splits.find(t => t.symbol === 'NFLX')
    expect(nflxSplit).toBeTruthy()
    expect(nflxSplit!.quantity).toBe(9)
    expect(nflxSplit!.cashAmount).toBe(0)
  })

  it('parses Dividends section', async () => {
    const result = await ibkr.parse(fixture('ibkr-yearly-2025.csv'))
    const divs = result.txns.filter(t => t.kind === 'dividend')
    expect(divs.length).toBeGreaterThan(0)
  })

  it('parses Withholding Tax section', async () => {
    const result = await ibkr.parse(fixture('ibkr-yearly-2025.csv'))
    const wh = result.txns.filter(t => t.kind === 'fee' && t.feeKind === 'withholding')
    expect(wh.length).toBeGreaterThan(0)
  })

  it('all trades have a valid exchange MIC', async () => {
    const result = await ibkr.parse(fixture('ibkr-yearly-2025.csv'))
    const trades = result.txns.filter(t => t.kind === 'buy' || t.kind === 'sell')
    // splits have no exchange requirement but normal trades must
    const normalTrades = trades.filter(t => t.pricePerShare !== 0)
    expect(normalTrades.every(t => t.exchange)).toBe(true)
  })

  it('produces stable externalIds on re-parse', async () => {
    const a = await ibkr.parse(fixture('ibkr-yearly-2025.csv'))
    const b = await ibkr.parse(fixture('ibkr-yearly-2025.csv'))
    expect(a.txns.map(t => t.externalId)).toEqual(b.txns.map(t => t.externalId))
  })

  it('existing detect() still accepts Transaction History format', () => {
    expect(ibkr.detect(fixture('ibkr-2026.csv'))).toBe(true)
  })
})

describe('ibkr parser', () => {
  it('detect() accepts IBKR Activity Statement CSV', async () => {
    expect(ibkr.detect(fixture('ibkr-2026.csv'))).toBe(true)
  })

  it('parses Buy rows into CanonicalTxn[]', async () => {
    const result = await ibkr.parse(fixture('ibkr-2026.csv'))
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

  it('routes Forex Trade Component and Adjustment to unsupported (internal bookkeeping)', async () => {
    const result = await ibkr.parse(fixture('ibkr-2026.csv'))
    const reasons = result.unsupported.map(u => u.reason)
    expect(reasons.some(r => /Forex Trade Component/i.test(r))).toBe(true)
    expect(reasons.some(r => /Adjustment/i.test(r))).toBe(true)
    // Dividends and fees are now parsed into txns, not unsupported
    expect(reasons.every(r => !/Dividend/i.test(r))).toBe(true)
    expect(reasons.every(r => !/Foreign Tax Withholding/i.test(r))).toBe(true)
  })

  it('parses Dividend rows into CanonicalTxn with kind=dividend', async () => {
    const result = await ibkr.parse(fixture('ibkr-2026.csv'))
    const dividends = result.txns.filter(t => t.kind === 'dividend')
    expect(dividends.length).toBeGreaterThan(0)
    const d = dividends[0]
    expect(d.broker).toBe('ibkr')
    expect(d.kind).toBe('dividend')
    expect(d.symbol).toBeTruthy()
    expect(d.cashAmount).toBeGreaterThan(0)  // dividends are inflows (positive)
    expect(d.settlementCurrency).toBe('EUR')
    expect(d.externalId).toMatch(/^[0-9a-f]+$/)
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('parses Foreign Tax Withholding rows into CanonicalTxn with kind=fee feeKind=withholding', async () => {
    const result = await ibkr.parse(fixture('ibkr-2026.csv'))
    const withholdings = result.txns.filter(t => t.kind === 'fee' && t.feeKind === 'withholding')
    expect(withholdings.length).toBeGreaterThan(0)
    const w = withholdings[0]
    expect(w.kind).toBe('fee')
    expect(w.feeKind).toBe('withholding')
    expect(w.symbol).toBeTruthy()
    expect(w.cashAmount).toBeLessThan(0)  // withholdings are outflows (negative)
  })

  it('parses Other Fee rows into CanonicalTxn with kind=fee feeKind=other-fee', async () => {
    const result = await ibkr.parse(fixture('ibkr-2026.csv'))
    const fees = result.txns.filter(t => t.kind === 'fee' && t.feeKind === 'other-fee')
    expect(fees.length).toBeGreaterThan(0)
  })

  it('parses Sales Tax rows into CanonicalTxn with kind=fee feeKind=sales-tax', async () => {
    const result = await ibkr.parse(fixture('ibkr-2026.csv'))
    const taxes = result.txns.filter(t => t.kind === 'fee' && t.feeKind === 'sales-tax')
    expect(taxes.length).toBeGreaterThan(0)
  })

  it('counts expected dividends and fees from fixture', async () => {
    const result = await ibkr.parse(fixture('ibkr-2026.csv'))
    const dividends = result.txns.filter(t => t.kind === 'dividend')
    const fees = result.txns.filter(t => t.kind === 'fee')
    expect(dividends.length).toBe(10)
    expect(fees.length).toBeGreaterThanOrEqual(15)  // 12 withholdings + 6 other-fees + 3 sales-tax
  })

  it('produces stable externalId hash from canonicalized fields (re-parse yields same id)', async () => {
    const a = await ibkr.parse(fixture('ibkr-2026.csv'))
    const b = await ibkr.parse(fixture('ibkr-2026.csv'))
    expect(a.txns.map(t => t.externalId)).toEqual(b.txns.map(t => t.externalId))
  })
})
