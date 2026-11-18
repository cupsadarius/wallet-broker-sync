/**
 * Net-worth-over-time: month-end samples combining
 *   - cash balance: running sum of Records on non-investment accounts,
 *     converted to base currency at the record date's FX.
 *   - investment value: replay AssetTransactions up to each sample date,
 *     price the resulting holdings at that date's cached close, FX-convert.
 *
 * Sampling cadence matches the performance chart so the two views stay in
 * lockstep visually.
 */
import type {
  MirrorAccount, MirrorAsset, MirrorAssetTransaction, MirrorRecord,
} from '../mirror'
import { latestClose, latestFx, resolveYahooTicker } from '../prices'
import { computeHoldings } from './holdings'

export type NetWorthPoint = {
  date: string
  cashBase: number
  investmentBase: number
  totalBase: number
}

export type NetWorthResult = {
  series: NetWorthPoint[]
  latest: NetWorthPoint | null
}

/** Each month end from the month of `start`, then `end` itself. */
export function monthEndSamples(start: string, end: Date): string[] {
  const startDate = new Date(start + 'T00:00:00Z')
  const samples: string[] = []
  for (
    let d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0));
    d <= end;
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0))
  ) {
    samples.push(d.toISOString().slice(0, 10))
  }
  const todayIso = end.toISOString().slice(0, 10)
  if (samples[samples.length - 1] !== todayIso) samples.push(todayIso)
  return samples
}

export async function computeNetWorth(input: {
  baseCurrency: string
  accounts: MirrorAccount[]
  txns: MirrorAssetTransaction[]
  records: MirrorRecord[]
  byAssetId: Map<string, MirrorAsset>
}): Promise<NetWorthResult> {
  const { baseCurrency, accounts, txns, records, byAssetId } = input
  const investmentAccountIds = new Set(
    accounts.filter(a => a.accountType === 7).map(a => a.id),
  )
  const cashAccountIds = new Set(
    accounts.filter(a => a.accountType !== 7).map(a => a.id),
  )

  const investTxns = txns
    .filter(t => investmentAccountIds.has(t.accountId))
    .sort((a, b) => a.date.localeCompare(b.date))
  const cashRecords = records
    .filter(r => cashAccountIds.has(r.accountId))
    .sort((a, b) => a.recordDate.localeCompare(b.recordDate))

  // Determine the earliest event date to anchor sampling.
  const firstDate = [
    investTxns[0]?.date,
    cashRecords[0]?.recordDate,
  ].filter((s): s is string => !!s).sort()[0]
  if (!firstDate) return { series: [], latest: null }

  const samples = monthEndSamples(firstDate, new Date())

  const series: NetWorthPoint[] = []
  for (const asOf of samples) {
    // --- investment side ---
    const uptoTxns = investTxns.filter(t => t.date <= asOf)
    const holdings = computeHoldings(uptoTxns, byAssetId)
    let investmentBase = 0
    for (const h of holdings) {
      const ticker = resolveYahooTicker(h.symbol, h.exchangeCode)
      if (!ticker) continue
      const close = await latestClose(ticker, asOf)
      if (!close) continue
      const fx = await latestFx(close.currency || h.currency || baseCurrency, baseCurrency, asOf)
      if (fx === null) continue
      investmentBase += close.close * h.quantity * fx
    }

    // --- cash side ---
    let cashBase = 0
    for (const r of cashRecords) {
      if (r.recordDate > asOf) break
      if (!r.amount) continue
      const ccy = r.currencyCode || baseCurrency
      const fx = await latestFx(ccy, baseCurrency, r.recordDate)
      if (fx === null) continue
      const signed = r.recordType === 0 ? +1 : r.recordType === 1 ? -1 : +1
      cashBase += signed * (r.amount / 100) * fx
    }

    series.push({
      date: asOf,
      cashBase,
      investmentBase,
      totalBase: cashBase + investmentBase,
    })
  }

  return {
    series,
    latest: series.length > 0 ? series[series.length - 1] : null,
  }
}
