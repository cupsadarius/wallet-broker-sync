/**
 * Daily close prices + FX rates, sourced from Yahoo Finance's public chart
 * endpoint. The data lives in `price_history` (asset close in listing ccy)
 * and `fx_history` (1 base in quote, e.g. USD→EUR).
 *
 * Caching policy:
 *   - past dates  → INSERT OR IGNORE; once cached, never overwrite.
 *   - today's row → INSERT OR REPLACE; the last close updates as the day
 *     progresses and Yahoo backfills.
 *
 * Rate limiting is deliberately conservative (100 ms between symbols, single
 * 429 retry with 2 s delay). Yahoo's unofficial API has no SLA — we treat
 * any failure as soft and skip the symbol, so a flaky price doesn't break
 * the dashboard.
 */
import { db, runMigrations } from '@/src/storage/db'
import { priceHistory, fxHistory, assetAlias } from '@/src/storage/schema'
import { sql } from 'drizzle-orm'
import { readMirror, getBaseCurrency, withFallbackTrades } from './mirror'
import { crossRate } from './compute/fx'

// ISO MIC codes the user's brokers (XTB / IBKR / Tradeville) actually trade
// on, mapped to the Yahoo suffix. US exchanges use no suffix; map to '' so
// the lookup still resolves rather than skipping.
const MIC_TO_YAHOO_SUFFIX: Record<string, string> = {
  // United States
  XNAS: '', XNYS: '', XASE: '', ARCX: '', BATS: '', XNGS: '', XOTC: '',
  // Europe
  XETR: '.DE', XFRA: '.F', XLON: '.L', XAMS: '.AS', XPAR: '.PA',
  XBRU: '.BR', XLIS: '.LS', XMAD: '.MC', XMIL: '.MI', XSWX: '.SW',
  XSTO: '.ST', XCSE: '.CO', XHEL: '.HE', XOSL: '.OL', XWAR: '.WA',
  XBUD: '.BD', XPRA: '.PR',
  // Romania (Bucharest) — many local listings have no Yahoo coverage; mapped
  // for the few that do (e.g. TLV.RO).
  XBSE: '.RO',
}

export type SymbolResolution = {
  assetId: string
  walletSymbol: string
  walletExchange: string
  yahooTicker: string | null  // null = no coverage
  currency: string
}

/**
 * Build the Yahoo ticker for a Wallet (canonical) asset. Applies the
 * `asset_alias` table when a user has remapped a broker-side symbol to a
 * canonical form, then converts MIC to the Yahoo suffix.
 */
export function resolveYahooTicker(
  walletSymbol: string,
  walletExchange: string,
): string | null {
  const mic = walletExchange.toUpperCase()
  const suffix = MIC_TO_YAHOO_SUFFIX[mic]
  if (suffix === undefined) {
    // Unknown exchange — best-effort: try the bare symbol on US markets.
    // If Yahoo doesn't recognise it, the chart fetch will 404 and we skip.
    return walletSymbol.toUpperCase()
  }
  return `${walletSymbol.toUpperCase()}${suffix}`
}

type YahooChartResponse = {
  chart: {
    result: Array<{
      meta: { currency?: string; symbol: string }
      timestamp: number[]
      indicators: { quote: Array<{ close: (number | null)[] }> }
    }> | null
    error: { code?: string; description?: string } | null
  }
}

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function fetchYahooChart(ticker: string, fromDate: string): Promise<YahooChartResponse | null> {
  const period1 = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000)
  const period2 = Math.floor(Date.now() / 1000)
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          // Yahoo blocks fetches without a UA; a generic browser string is
          // enough to get the unauthenticated chart payload.
          'user-agent': 'Mozilla/5.0 (compatible; wallet-broker-sync/1.0)',
          'accept': 'application/json',
        },
        // Avoid Next.js fetch cache eating the response.
        cache: 'no-store',
      })
      if (res.status === 429) {
        if (attempt === 0) { await sleep(2000); continue }
        return null
      }
      if (res.status === 404) return null
      if (!res.ok) return null
      return (await res.json()) as YahooChartResponse
    } catch {
      if (attempt === 0) { await sleep(500); continue }
      return null
    }
  }
  return null
}

function toIsoDate(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10)
}

function intClose(price: number): number {
  // 4 decimal places fits all reasonable equity/ETF prices without floats.
  return Math.round(price * 10_000)
}

function intRate(rate: number): number {
  return Math.round(rate * 1_000_000)
}

export type BackfillResult = {
  symbol: string
  inserted: number
  upserted: number
  skipped: 'no_data' | 'unsupported' | null
}

export async function backfillSymbol(
  yahooTicker: string,
  fromDate: string,
  expectedCurrency: string,
): Promise<BackfillResult> {
  const data = await fetchYahooChart(yahooTicker, fromDate)
  if (!data?.chart?.result?.[0]) {
    return { symbol: yahooTicker, inserted: 0, upserted: 0, skipped: 'no_data' }
  }
  const r = data.chart.result[0]
  const timestamps = r.timestamp ?? []
  const closes = r.indicators?.quote?.[0]?.close ?? []
  const ccy = r.meta?.currency || expectedCurrency

  const today = new Date().toISOString().slice(0, 10)
  let inserted = 0
  let upserted = 0

  // better-sqlite3 is sync; per-row upsert is fine at personal-portfolio
  // scale (a few thousand rows per symbol).
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i]
    if (close === null || close === undefined || !Number.isFinite(close)) continue
    const date = toIsoDate(timestamps[i])
    const row = {
      symbol: yahooTicker,
      date,
      close: intClose(close),
      currency: ccy,
    }
    if (date === today) {
      await db.insert(priceHistory)
        .values(row)
        .onConflictDoUpdate({
          target: [priceHistory.symbol, priceHistory.date],
          set: { close: row.close, currency: row.currency },
        })
      upserted++
    } else {
      await db.insert(priceHistory)
        .values(row)
        .onConflictDoNothing()
      inserted++
    }
  }

  return { symbol: yahooTicker, inserted, upserted, skipped: null }
}

type FrankfurterResponse = {
  amount?: number
  base?: string
  rates?: Record<string, Record<string, number>>
}

async function fetchFrankfurter(
  base: string, quote: string, fromDate: string,
): Promise<FrankfurterResponse | null> {
  // Frankfurter (ECB-backed, no key, daily back to 1999). Format:
  // /<from>..<to>?base=BASE&symbols=QUOTE — current API uses from/to params.
  const today = new Date().toISOString().slice(0, 10)
  const url = `https://api.frankfurter.dev/v1/${fromDate}..${today}?from=${base.toUpperCase()}&to=${quote.toUpperCase()}`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.status === 429) { if (attempt === 0) { await sleep(2000); continue } return null }
      if (!res.ok) return null
      return (await res.json()) as FrankfurterResponse
    } catch {
      if (attempt === 0) { await sleep(500); continue }
      return null
    }
  }
  return null
}

export async function backfillFx(
  base: string,
  quote: string,
  fromDate: string,
): Promise<BackfillResult> {
  const B = base.toUpperCase()
  const Q = quote.toUpperCase()
  if (B === Q) return { symbol: `${B}${Q}`, inserted: 0, upserted: 0, skipped: null }

  // Frankfurter rejects fromDate before 1999-01-04; clamp to be safe.
  const clamped = fromDate < '1999-01-04' ? '1999-01-04' : fromDate
  const data = await fetchFrankfurter(B, Q, clamped)
  if (!data?.rates) {
    return { symbol: `${B}${Q}`, inserted: 0, upserted: 0, skipped: 'no_data' }
  }
  const today = new Date().toISOString().slice(0, 10)
  let inserted = 0
  let upserted = 0
  for (const [date, perDate] of Object.entries(data.rates)) {
    const rate = perDate?.[Q]
    if (!Number.isFinite(rate)) continue
    const row = { base: B, quote: Q, date, rate: intRate(rate) }
    if (date === today) {
      await db.insert(fxHistory)
        .values(row)
        .onConflictDoUpdate({
          target: [fxHistory.base, fxHistory.quote, fxHistory.date],
          set: { rate: row.rate },
        })
      upserted++
    } else {
      await db.insert(fxHistory).values(row).onConflictDoNothing()
      inserted++
    }
  }
  return { symbol: `${B}${Q}`, inserted, upserted, skipped: null }
}

/**
 * For every asset that has at least one transaction, ensure the price history
 * is backfilled from the first trade date to today. Also backfills FX pairs
 * from each asset's listing currency into the user's base currency.
 */
export async function ensurePricesForHoldings(): Promise<{
  resolutions: SymbolResolution[]
  priceResults: BackfillResult[]
  fxResults: BackfillResult[]
}> {
  runMigrations()
  const snapshot = await readMirror()
  if (!snapshot) {
    return { resolutions: [], priceResults: [], fxResults: [] }
  }

  // Compute first trade date per asset.
  const { transactions, byAssetId } = withFallbackTrades(snapshot)
  const firstTradeByAsset = new Map<string, string>()
  for (const t of transactions) {
    const prev = firstTradeByAsset.get(t.assetId)
    if (!prev || t.date < prev) firstTradeByAsset.set(t.assetId, t.date)
  }

  // assetAlias is currently broker-keyed; for canonical symbol resolution we
  // only need the asset's own (symbol, exchangeCode). Aliases on the canonical
  // side aren't expected today, but a future migration can extend this.
  const aliasRows = await db.select().from(assetAlias)
  void aliasRows

  const resolutions: SymbolResolution[] = []
  for (const a of byAssetId.values()) {
    if (!firstTradeByAsset.has(a.id)) continue  // never traded — skip
    resolutions.push({
      assetId: a.id,
      walletSymbol: a.symbol,
      walletExchange: a.exchangeCode,
      yahooTicker: resolveYahooTicker(a.symbol, a.exchangeCode),
      currency: a.currencyCode,
    })
  }

  const priceResults: BackfillResult[] = []
  for (const r of resolutions) {
    if (!r.yahooTicker) {
      priceResults.push({ symbol: `${r.walletExchange}:${r.walletSymbol}`, inserted: 0, upserted: 0, skipped: 'unsupported' })
      continue
    }
    const from = firstTradeByAsset.get(r.assetId)!
    const result = await backfillSymbol(r.yahooTicker, from, r.currency)
    priceResults.push(result)
    await sleep(100)  // gentle rate limit
  }

  // FX pairs: every distinct listing currency → base currency.
  const baseCcy = await getBaseCurrency()
  const distinctCurrencies = new Set<string>()
  for (const r of resolutions) {
    if (r.currency && r.currency !== baseCcy) distinctCurrencies.add(r.currency.toUpperCase())
  }
  // Also include cash-account currencies so net-worth + spending work.
  for (const acc of snapshot.accounts) {
    if (acc.currencyCode && acc.currencyCode !== baseCcy) distinctCurrencies.add(acc.currencyCode.toUpperCase())
  }
  // Also include any record currency we'll need to convert — cash records can
  // predate the earliest investment trade by years.
  for (const r of snapshot.records) {
    if (r.currencyCode && r.currencyCode !== baseCcy) distinctCurrencies.add(r.currencyCode.toUpperCase())
  }
  // Anchor FX window at the earliest date across trades AND records so we
  // can FX-convert old cash records, not just trades.
  const earliestRecord = snapshot.records
    .map(r => r.recordDate)
    .filter((d): d is string => !!d)
    .sort()[0]
  const earliestTrade = Array.from(firstTradeByAsset.values()).sort()[0]
  const earliestDate = [earliestRecord, earliestTrade]
    .filter((d): d is string => !!d)
    .sort()[0]
    ?? new Date().toISOString().slice(0, 10)

  const fxResults: BackfillResult[] = []
  for (const ccy of distinctCurrencies) {
    const result = await backfillFx(ccy, baseCcy, earliestDate)
    fxResults.push(result)
    await sleep(100)
  }

  return { resolutions, priceResults, fxResults }
}

/**
 * Latest cached close for a Yahoo ticker on or before `onDate`. Used by the
 * valuation layer to price current holdings without needing live quotes.
 */
export async function latestClose(
  yahooTicker: string,
  onDate: string,
): Promise<{ date: string; close: number; currency: string } | null> {
  const rows = db.all<{ date: string; close: number; currency: string }>(sql`
    SELECT date, close, currency FROM price_history
    WHERE symbol = ${yahooTicker} AND date <= ${onDate}
    ORDER BY date DESC LIMIT 1
  `)
  const row = rows[0]
  if (!row) return null
  return { date: row.date, close: row.close / 10_000, currency: row.currency }
}

export async function latestFx(
  base: string,
  quote: string,
  onDate: string,
): Promise<number | null> {
  return crossRate(base, quote, (b, q) => {
    const rows = db.all<{ rate: number }>(sql`
      SELECT rate FROM fx_history
      WHERE base = ${b} AND quote = ${q} AND date <= ${onDate}
      ORDER BY date DESC LIMIT 1
    `)
    return rows[0] ? rows[0].rate / 1_000_000 : null
  }, await getBaseCurrency())
}
