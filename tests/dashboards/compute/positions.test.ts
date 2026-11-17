import { describe, it, expect } from 'vitest'
import { buildPositions } from '@/src/dashboards/compute/positions'
import type { ValuedHolding } from '@/src/dashboards/compute/valuation'
import type { Maturity } from '@/src/dashboards/compute/maturities'

function vh(symbol: string, valueBase: number | null, costBase: number): ValuedHolding {
  return {
    assetId: symbol, symbol, exchangeCode: 'XBSE', currency: 'RON', quantity: 10, avgCost: 1,
    totalCost: 10, buyCount: 1, sellCount: 0, firstTradeDate: null, lastTradeDate: null,
    yahooTicker: null, priceNative: null, priceDate: null, valueNative: null, fxToBase: 1,
    valueBase, costBase, unrealizedPnlBase: null, unrealizedPnlPct: null, allocationPct: null,
  }
}
const bond: Maturity = {
  id: 1, kind: 'bond', name: 'Fidelis', accountId: null, symbol: 'R2704A', currency: 'EUR',
  principal: 1000, rateBps: null, startDate: '2025-01-01', maturityDate: '2027-04-17',
}
const deposit: Maturity = { ...bond, id: 2, kind: 'deposit', name: 'BT', symbol: null, currency: 'RON', principal: 500 }

describe('buildPositions', () => {
  const rates = new Map([['RON', 1], ['EUR', 5]])

  it('values priced holdings at market and unpriced ones at cost', () => {
    const { positions, investedBase, costBase } = buildPositions(
      [{ broker: 'Tradeville', holdings: [vh('TLV', 300, 200), vh('TVBETETF', null, 150)] }], [], '2026-11-17', rates,
    )
    expect(positions.map(p => [p.symbol, p.valueBase, p.basis])).toEqual([['TLV', 300, 'market'], ['TVBETETF', 150, 'cost']])
    expect(investedBase).toBe(450)
    expect(costBase).toBe(350)
  })

  it('values a running bond at par in base currency and drops the matching holding', () => {
    const { positions, investedBase } = buildPositions(
      [{ broker: 'Tradeville', holdings: [vh('R2704A', null, 4000)] }], [bond, deposit], '2026-11-17', rates,
    )
    expect(positions.map(p => [p.symbol, p.valueBase, p.basis, p.kind])).toEqual([
      ['R2704A', 5000, 'par', 'bond'],
      ['BT', 500, 'par', 'deposit'],
    ])
    expect(investedBase).toBe(5000)
  })
})
