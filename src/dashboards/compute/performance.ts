/**
 * Portfolio performance metrics: MWR (money-weighted return, via XIRR) and a
 * monthly portfolio-value series that doubles as the chart data + the
 * Modified-Dietz TWR input.
 *
 * MWR is what the user feels — it reflects timing of deposits/sales. TWR
 * strips out cash-flow timing to compare against a benchmark. We compute both
 * over the same window (first trade → today) so the dashboard can show them
 * side by side.
 */
import xirr from 'xirr'
import type {
  MirrorAsset,
  MirrorAssetTransaction,
} from '../mirror'
import { latestClose, latestFx, resolveYahooTicker } from '../prices'
import { computeHoldings } from './holdings'

export type CashFlow = {
  date: string             // YYYY-MM-DD
  amountBase: number       // signed: + into portfolio, - out
}

export type ValuePoint = {
  date: string             // last day of the bucket
  valueBase: number
}

export type PerformanceResult = {
  mwr: number | null               // annualized, decimal (0.12 = 12%)
  twr: number | null               // annualized, decimal
  totalContributedBase: number     // sum of positive cash inflows (cost in)
  totalRealizedBase: number        // sum of positive cash outflows (sells)
  currentValueBase: number
  totalReturnBase: number          // currentValue + realized - contributed
  totalReturnPct: number | null
  series: ValuePoint[]
  cashFlows: CashFlow[]
}

type Ctx = {
  baseCurrency: string
  txns: MirrorAssetTransaction[]
  byAssetId: Map<string, MirrorAsset>
  accountIds?: Set<string>
}

/**
 * Build base-currency cash flows from asset transactions. Each buy is a
 * negative CF (money invested), each sell is a positive CF.
 */
async function buildCashFlows(ctx: Ctx): Promise<CashFlow[]> {
  const filtered = ctx.accountIds
    ? ctx.txns.filter(t => ctx.accountIds!.has(t.accountId))
    : ctx.txns
  const flows: CashFlow[] = []
  for (const t of filtered) {
    const asset = ctx.byAssetId.get(t.assetId)
    const tradeCcy = t.priceCurrencyCode || asset?.currencyCode || ctx.baseCurrency
    // priceCurrencyCode is an ISO code already in Wallet; no Currency-doc
    // indirection here, unlike currencyId on Records.
    const fx = await latestFx(tradeCcy, ctx.baseCurrency, t.date)
    if (fx === null) continue  // can't price this flow — skip
    const gross = (t.price / 100) * t.quantity * fx
    if (!Number.isFinite(gross) || gross === 0) continue
    flows.push({
      date: t.date,
      // Buy (0) → cash leaves wallet = negative inflow to portfolio model
      // Sell (1) → cash returns = positive
      amountBase: t.transactionType === 0 ? -gross : +gross,
    })
  }
  flows.sort((a, b) => a.date.localeCompare(b.date))
  return flows
}

/**
 * Sample the portfolio's market value at the end of every month from the
 * first trade to today. Each sample replays trades up to that point to
 * derive net quantity per asset, then prices using the latest cached close.
 */
async function buildValueSeries(ctx: Ctx): Promise<ValuePoint[]> {
  const filtered = ctx.accountIds
    ? ctx.txns.filter(t => ctx.accountIds!.has(t.accountId))
    : ctx.txns
  if (filtered.length === 0) return []
  filtered.sort((a, b) => a.date.localeCompare(b.date))
  const start = filtered[0].date
  const startDate = new Date(start + 'T00:00:00Z')

  const today = new Date()
  const samples: string[] = []
  // Iterate month-ends from the trade-start month → current month.
  for (
    let d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0));
    d <= today;
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0))
  ) {
    samples.push(d.toISOString().slice(0, 10))
  }
  // Always include "now" as the final sample.
  const todayIso = today.toISOString().slice(0, 10)
  if (samples[samples.length - 1] !== todayIso) samples.push(todayIso)

  const points: ValuePoint[] = []
  for (const asOf of samples) {
    const upto = filtered.filter(t => t.date <= asOf)
    const holdings = computeHoldings(upto, ctx.byAssetId)
    let total = 0
    for (const h of holdings) {
      const ticker = resolveYahooTicker(h.symbol, h.exchangeCode)
      if (!ticker) continue
      const close = await latestClose(ticker, asOf)
      if (!close) continue
      const fx = await latestFx(close.currency || h.currency || ctx.baseCurrency, ctx.baseCurrency, asOf)
      if (fx === null) continue
      total += close.close * h.quantity * fx
    }
    points.push({ date: asOf, valueBase: total })
  }
  return points
}

/**
 * Modified Dietz TWR over the full window, annualized.
 *
 * TWR_period = (V_end - V_start - Σ CF) / (V_start + Σ (CF * weight))
 * where weight = (T - t) / T  (time-weighted, days from CF to period end).
 *
 * For a personal portfolio this is a defensible approximation; chaining
 * sub-period returns would be marginally more accurate but requires a daily
 * series, which we deliberately skipped for cost.
 */
function modifiedDietz(
  series: ValuePoint[],
  cashFlows: CashFlow[],
): number | null {
  if (series.length < 2) return null
  const start = series[0]
  const end = series[series.length - 1]
  const startMs = Date.parse(start.date + 'T00:00:00Z')
  const endMs = Date.parse(end.date + 'T00:00:00Z')
  const totalDays = (endMs - startMs) / 86_400_000
  if (totalDays <= 0) return null

  let weightedCfSum = 0
  let cfSum = 0
  for (const cf of cashFlows) {
    const tMs = Date.parse(cf.date + 'T00:00:00Z')
    if (tMs < startMs || tMs > endMs) continue
    // Convert: deposits/contributions show up as -ve amountBase in our model
    // (cash leaving wallet → into portfolio). For TWR we want +ve = inflow
    // *to* the portfolio. So flip sign.
    const contribution = -cf.amountBase
    const weight = (endMs - tMs) / (endMs - startMs)
    weightedCfSum += contribution * weight
    cfSum += contribution
  }

  const denom = start.valueBase + weightedCfSum
  if (denom <= 0) return null
  const periodReturn = (end.valueBase - start.valueBase - cfSum) / denom
  // Annualize.
  const years = totalDays / 365.25
  if (years <= 0) return periodReturn
  return Math.pow(1 + periodReturn, 1 / years) - 1
}

export async function computePerformance(ctx: Ctx): Promise<PerformanceResult> {
  const [cashFlows, series] = await Promise.all([
    buildCashFlows(ctx),
    buildValueSeries(ctx),
  ])
  const currentValueBase = series.length > 0 ? series[series.length - 1].valueBase : 0

  let totalContributed = 0
  let totalRealized = 0
  for (const cf of cashFlows) {
    if (cf.amountBase < 0) totalContributed += -cf.amountBase
    else totalRealized += cf.amountBase
  }

  // XIRR: cash flows + terminal value as positive flow today.
  let mwr: number | null = null
  if (cashFlows.length > 0 && currentValueBase > 0) {
    const xirrInput = [
      ...cashFlows.map(cf => ({ amount: cf.amountBase, when: new Date(cf.date + 'T00:00:00Z') })),
      { amount: currentValueBase, when: new Date() },
    ]
    try {
      mwr = xirr(xirrInput)
      if (!Number.isFinite(mwr)) mwr = null
    } catch {
      mwr = null
    }
  }

  const twr = modifiedDietz(series, cashFlows)

  const totalReturnBase = currentValueBase + totalRealized - totalContributed
  const totalReturnPct = totalContributed > 0 ? (totalReturnBase / totalContributed) * 100 : null

  return {
    mwr,
    twr,
    totalContributedBase: totalContributed,
    totalRealizedBase: totalRealized,
    currentValueBase,
    totalReturnBase,
    totalReturnPct,
    series,
    cashFlows,
  }
}
