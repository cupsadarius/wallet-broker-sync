import { describe, it, expect } from 'vitest'
import { parseTradeNote, fallbackTrades } from '@/src/dashboards/compute/fallback'
import { computeHoldings } from '@/src/dashboards/compute/holdings'
import type { MirrorRecord } from '@/src/dashboards/mirror'

function rec(id: string, date: string, note: string, isTradeFallback = true): MirrorRecord {
  return {
    id, accountId: 'tv', amount: 0, currencyCode: 'RON', recordDate: date, note,
    isTradeFallback, transfer: false, bankSynced: false,
  }
}

describe('parseTradeNote', () => {
  it('reads side, quantity, symbol, price and currency', () => {
    expect(parseTradeNote('Buy 7 TVBETETF @ 27.55 RON (Pret dirty:)')).toEqual({
      side: 'buy', quantity: 7, symbol: 'TVBETETF', price: 27.55, currency: 'RON',
    })
    expect(parseTradeNote('Sell 1000 R2604B @ 100 RON (Rascumparare principal Pret dirty:)')).toMatchObject({
      side: 'sell', quantity: 1000, symbol: 'R2604B', price: 100,
    })
  })
  it('ignores notes that are not trades', () => {
    expect(parseTradeNote('plata cupon R2604B Pret dirty:')).toBeNull()
    expect(parseTradeNote('dividend TLV Pret dirty:')).toBeNull()
  })
})

describe('fallbackTrades', () => {
  it('turns fallback records into holdings with average cost', () => {
    const records = [
      rec('1', '2025-01-01', 'Buy 10 SNP @ 1 RON (x)'),
      rec('2', '2025-02-01', 'Buy 10 SNP @ 2 RON (x)'),
      rec('3', '2025-03-01', 'Sell 5 SNP @ 3 RON (x)'),
      rec('4', '2025-01-01', 'Buy 200 R2602A @ 100 RON (x)'),
      rec('5', '2026-02-19', 'Sell 200 R2602A @ 100 RON (x)'),
      rec('6', '2025-01-01', 'Buy 1 AAPL @ 100 USD', false),
    ]
    const { transactions, assets } = fallbackTrades(records, () => 'XBSE')
    const holdings = computeHoldings(transactions, new Map(assets.map(a => [a.id, a])))
    expect(holdings).toHaveLength(1)
    expect(holdings[0]).toMatchObject({
      symbol: 'SNP', exchangeCode: 'XBSE', currency: 'RON', quantity: 15, avgCost: 1.5,
    })
  })
})
