import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tradeville } from '@/src/parsers/tradeville'

const fixture = (name: string) => ({
  bytes: new Uint8Array(readFileSync(resolve('tests/parsers/fixtures', name))),
  filename: name,
})

describe('tradeville parser', () => {
  it('detect() accepts the HTML export', () => {
    expect(tradeville.detect(fixture('tradeville-2026.html'))).toBe(true)
  })

  it('detect() rejects non-Tradeville HTML', () => {
    const fakeHtml = new TextEncoder().encode('<html><body><table><tr><td>nope</td></tr></table></body></html>')
    expect(tradeville.detect({ bytes: fakeHtml, filename: 'random.html' })).toBe(false)
  })

  it('parses cumpărare (buy) rows into CanonicalTxn[]', () => {
    const result = tradeville.parse(fixture('tradeville-2026.html'))
    expect(result.txns.length).toBeGreaterThan(0)
    const buy = result.txns.find(t => t.kind === 'buy')
    expect(buy).toBeTruthy()
    expect(buy!.broker).toBe('tradeville')
    expect(buy!.symbol).toBeTruthy()
    expect(buy!.exchange).toBe('XBSE')              // Bucharest stock exchange
    expect(buy!.tradeCurrency).toBe('RON')
    expect(buy!.settlementCurrency).toBe('RON')
    expect(buy!.quantity).toBeGreaterThan(0)
    expect(buy!.pricePerShare).toBeGreaterThan(0)
    expect(buy!.cashAmount).not.toBe(0)             // sign convention: signed value from broker
    expect(buy!.externalId).toMatch(/^[0-9a-f]+$/)  // content hash since no broker txn id
  })

  it('routes deposits, dividends, and other non-trade rows to unsupported', () => {
    const result = tradeville.parse(fixture('tradeville-2026.html'))
    expect(result.unsupported.length).toBeGreaterThan(0)
    const reasons = result.unsupported.map(u => u.reason).join(' ')
    expect(/deposit|depunere|non-trade|unsupported/i.test(reasons)).toBe(true)
  })

  it('produces stable externalId hash (re-parse yields same ids)', () => {
    const a = tradeville.parse(fixture('tradeville-2026.html'))
    const b = tradeville.parse(fixture('tradeville-2026.html'))
    expect(a.txns.map(t => t.externalId)).toEqual(b.txns.map(t => t.externalId))
  })
})
