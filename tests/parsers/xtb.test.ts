import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { xtb } from '@/src/parsers/xtb'

const fixture = (name: string) => ({
  bytes: new Uint8Array(readFileSync(resolve('tests/parsers/fixtures', name))),
  filename: name,
})

describe('xtb parser', () => {
  it('detect() accepts xlsx', async () => {
    expect(xtb.detect(fixture('xtb-2026.xlsx'))).toBe(true)
  })
  it('parses real XTB export into CanonicalTxn[]', async () => {
    const result = await xtb.parse(fixture('xtb-2026.xlsx'))
    expect(result.txns.length).toBeGreaterThan(0)
    const buy = result.txns.find(t => t.kind === 'buy')
    expect(buy).toBeTruthy()
    expect(buy!.broker).toBe('xtb')
    expect(buy!.symbol).toBeTruthy()
    expect(buy!.exchange).toBeTruthy()
    expect(buy!.quantity).toBeGreaterThan(0)
    expect(buy!.pricePerShare).toBeGreaterThan(0)
    expect(buy!.tradeCurrency).toBe('EUR')
    expect(buy!.settlementCurrency).toBe('EUR')
    expect(buy!.externalId).toMatch(/^\d+$/)
    expect(buy!.date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
  it('emits unsupported rows for non-stock-purchase types', async () => {
    const result = await xtb.parse(fixture('xtb-2026.xlsx'))
    expect(result.unsupported.some(u => /deposit|withdrawal|dividend/i.test(u.reason))).toBe(true)
  })

  // Nov 2026 format: sheet "Cash Operations", ID no longer first column, Symbol -> Ticker, times in UTC.
  it('parses the Nov 2026 export format', async () => {
    const f = fixture('xtb-2026-11.xlsx')
    expect(xtb.detect(f)).toBe(true)
    const result = await xtb.parse(f)
    const buy = result.txns.find(t => t.externalId === '1417866320')
    expect(buy).toMatchObject({
      kind: 'buy', symbol: 'VUAA', quantity: 1, pricePerShare: 128.25, cashAmount: -128.25,
    })
    expect(buy!.exchange).toBeTruthy()
    expect(result.txns.every(t => t.kind === 'buy' || t.kind === 'sell')).toBe(true)
    expect(result.unsupported.some(u => /Deposit/.test(u.reason))).toBe(true)
  })
})
