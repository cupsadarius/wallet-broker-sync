import type { ValuedHolding } from './valuation'
import { valueAt, type Maturity } from './maturities'

export type Position = {
  key: string
  symbol: string
  name?: string
  group: string                     // broker account name, "Bond" or "Deposit"
  quantity: number | null
  valueBase: number
  costBase: number
  basis: 'market' | 'cost' | 'par'  // market price, held at cost (no price), par + accrued
  kind: 'holding' | 'bond' | 'deposit'
  priceDate: string | null
}

/**
 * One list of positions: broker holdings, running bonds and deposits.
 * Deposits are listed but stay out of the invested totals: their account balance is cash.
 */
export function buildPositions(
  byBroker: { broker: string; holdings: ValuedHolding[] }[],
  maturities: Maturity[],
  asOf: string,
  rateToBase: Map<string, number | null>,
): { positions: Position[]; investedBase: number; costBase: number } {
  const running = maturities.filter(m => valueAt(m, asOf) > 0)
  const bondSymbols = new Set(running.filter(m => m.kind === 'bond' && m.symbol).map(m => m.symbol!.toUpperCase()))

  const positions: Position[] = []
  for (const { broker, holdings } of byBroker) {
    for (const h of holdings) {
      if (bondSymbols.has(h.symbol.toUpperCase())) continue
      const cost = h.costBase ?? 0
      positions.push({
        key: `${broker}:${h.assetId}`, symbol: h.symbol, name: h.name, group: broker,
        quantity: h.quantity, valueBase: h.valueBase ?? cost, costBase: cost,
        basis: h.valueBase === null ? 'cost' : 'market', kind: 'holding', priceDate: h.priceDate,
      })
    }
  }
  for (const m of running) {
    const rate = rateToBase.get(m.currency) ?? 0
    positions.push({
      key: `maturity:${m.id}`, symbol: m.kind === 'bond' ? (m.symbol ?? m.name) : m.name, name: m.name,
      group: m.kind === 'bond' ? 'Bond' : 'Deposit', quantity: null,
      valueBase: valueAt(m, asOf) * rate, costBase: m.principal * rate,
      basis: 'par', kind: m.kind, priceDate: null,
    })
  }

  const invested = positions.filter(p => p.kind !== 'deposit')
  return {
    positions,
    investedBase: invested.reduce((s, p) => s + p.valueBase, 0),
    costBase: invested.reduce((s, p) => s + p.costBase, 0),
  }
}
