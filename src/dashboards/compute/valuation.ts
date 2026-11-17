/**
 * Valuate current holdings: combine cost-basis holdings with the latest
 * cached close price + FX rate to derive current value, unrealized P&L,
 * and base-currency exposure.
 *
 * Designed to gracefully degrade: a missing price OR missing FX produces a
 * holding with `null` market value (so the UI can show "—") rather than
 * raising. That keeps the dashboard usable for OTC/Tradeville assets that
 * Yahoo doesn't cover.
 */
import type { Holding } from './holdings'
import { latestClose, latestFx, resolveYahooTicker } from '../prices'

export type ValuedHolding = Holding & {
  yahooTicker: string | null
  priceNative: number | null
  priceDate: string | null
  valueNative: number | null
  fxToBase: number | null
  valueBase: number | null
  costBase: number | null
  unrealizedPnlBase: number | null
  unrealizedPnlPct: number | null
  allocationPct: number | null   // share of total portfolio value (filled later)
}

export async function valuateHoldings(
  holdings: Holding[],
  baseCurrency: string,
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<ValuedHolding[]> {
  const valued: ValuedHolding[] = []
  for (const h of holdings) {
    const yahooTicker = resolveYahooTicker(h.symbol, h.exchangeCode)
    let priceNative: number | null = null
    let priceDate: string | null = null
    let valueNative: number | null = null
    let priceCurrency: string | null = null

    if (yahooTicker) {
      const close = await latestClose(yahooTicker, asOf)
      if (close) {
        priceNative = close.close
        priceDate = close.date
        priceCurrency = close.currency
        valueNative = priceNative * h.quantity
      }
    }

    // Use the price's own currency when Yahoo gives one, otherwise fall back
    // to the asset's listed currency from Wallet.
    const valuationCcy = priceCurrency || h.currency || baseCurrency
    const fxToBase = valuationCcy
      ? await latestFx(valuationCcy, baseCurrency, asOf)
      : null

    const valueBase = valueNative !== null && fxToBase !== null
      ? valueNative * fxToBase
      : null
    const costBase = fxToBase !== null
      ? h.totalCost * fxToBase
      : null
    const unrealizedPnlBase = valueBase !== null && costBase !== null
      ? valueBase - costBase
      : null
    const unrealizedPnlPct = unrealizedPnlBase !== null && costBase && costBase > 0
      ? (unrealizedPnlBase / costBase) * 100
      : null

    valued.push({
      ...h,
      yahooTicker,
      priceNative,
      priceDate,
      valueNative,
      fxToBase,
      valueBase,
      costBase,
      unrealizedPnlBase,
      unrealizedPnlPct,
      allocationPct: null,
    })
  }

  // Fill allocation% from total valued portfolio (only positions we managed
  // to price contribute to the denominator — others are flagged in the UI).
  const total = valued.reduce((s, v) => s + (v.valueBase ?? 0), 0)
  if (total > 0) {
    for (const v of valued) {
      if (v.valueBase !== null) v.allocationPct = (v.valueBase / total) * 100
    }
  }

  // Re-sort by base value desc; positions without a market value sink to the
  // bottom (sorted among themselves by cost basis).
  valued.sort((a, b) => {
    const av = a.valueBase ?? -1
    const bv = b.valueBase ?? -1
    if (av !== bv) return bv - av
    return b.totalCost - a.totalCost
  })
  return valued
}
