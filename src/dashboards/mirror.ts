/**
 * Dashboard-side wrapper around the existing Couch cache.
 *
 * The sync pipeline already mirrors every doc we care about
 * (Account/Currency/StocksFundsAsset/Category/AssetTransaction/Record) into
 * `couch_doc_cache` and walks `_changes` incrementally via `refreshCache`.
 * Rather than duplicate that into typed mirror tables, the dashboard reads
 * the same cache and projects raw JSON into the typed views below.
 *
 * Public surface:
 *   - syncMirror():   refresh from Couch (delta-only after first call)
 *   - isMirrorStale(): true if the last refresh was > maxAgeMs ago
 *   - readMirror():    return the current snapshot (typed, in memory)
 */
import { eq } from 'drizzle-orm'
import { db, runMigrations } from '@/src/storage/db'
import { config, couchDocCache, recordFallback } from '@/src/storage/schema'
import { CouchClient } from '@/src/sync/couch'
import { refreshCache, scopeFor, type DocBucket } from '@/src/sync/couch-cache'
import { loadCouchCreds } from '@/src/storage/credentials'
import { envelopeGroupName } from './envelopes'
import { fallbackTrades } from './compute/fallback'

export const LAST_SYNC_KEY = 'dashboard.lastMirrorSync'
export const BASE_CCY_KEY = 'dashboard.baseCurrency'
export const MIRROR_INTERVAL_KEY = 'dashboard.mirrorIntervalMs'

export const DEFAULT_BASE_CURRENCY = 'RON'
export const DEFAULT_MIRROR_INTERVAL_MS = 60 * 1000

// Typed views over the raw Couch docs. Money fields use the same int*100
// representation as Couch — convert at display time, not here.
export type MirrorAccount = {
  id: string
  name: string
  accountType: number   // 7 = investment
  currencyCode: string  // resolved via Currency map
  assetTypes: number[]
  initAmount: number    // int*100; balance = initAmount + signed records
  bank?: { provider: string; lastRefresh?: string; active: boolean }
}

export type MirrorAsset = {
  id: string
  symbol: string
  exchangeCode: string
  name?: string
  currencyCode: string
}

export type MirrorCategory = {
  id: string
  name: string
  envelopeId?: number
  groupName: string
}

export type MirrorAssetTransaction = {
  id: string
  accountId: string
  assetId: string
  transactionType: number  // 0 = buy, 1 = sell
  date: string             // ISO YYYY-MM-DD (taken from doc.date)
  quantity: number         // doc.quantity (int*100)
  price: number            // doc.price (int*100)
  priceCurrencyCode?: string
  cashAmount?: number      // doc.cashAmount (int*100)
  cashAmountCurrencyCode?: string
}

export type MirrorRecord = {
  id: string
  accountId: string
  categoryId?: string
  categoryName?: string
  categoryGroupName?: string  // derived from envelopeId
  amount: number           // int*100, sign per Wallet convention (recordType-derived)
  recordType?: number      // 0 income, 1 expense, 2 transfer
  currencyCode: string
  recordDate: string       // ISO YYYY-MM-DD
  note?: string
  /**
   * Records created by this tool's record-fallback path (e.g. Tradeville XBSE
   * trades that have no StocksFundsAsset doc in Wallet, so they're written as
   * Income/Expense Records). They are real trades, not real expenses, so
   * spending/cashflow aggregators exclude them by default.
   */
  isTradeFallback: boolean
  transfer: boolean
  transferAccountId?: string
  bankSynced: boolean
  payee?: string
}

export type MirrorSnapshot = {
  accounts: MirrorAccount[]
  assets: MirrorAsset[]
  categories: MirrorCategory[]
  transactions: MirrorAssetTransaction[]
  records: MirrorRecord[]
  byAssetId: Map<string, MirrorAsset>
  byAccountId: Map<string, MirrorAccount>
  byCategoryId: Map<string, MirrorCategory>
}

async function readConfigMap(): Promise<Record<string, string>> {
  const rows = await db.select().from(config)
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

async function writeConfig(key: string, value: string): Promise<void> {
  await db
    .insert(config)
    .values({ key, value })
    .onConflictDoUpdate({ target: config.key, set: { value } })
}

export async function getBaseCurrency(): Promise<string> {
  const cfg = await readConfigMap()
  return cfg[BASE_CCY_KEY] || DEFAULT_BASE_CURRENCY
}

export async function setBaseCurrency(code: string): Promise<void> {
  await writeConfig(BASE_CCY_KEY, code.toUpperCase())
}

export async function getMirrorIntervalMs(): Promise<number> {
  const cfg = await readConfigMap()
  const n = Number(cfg[MIRROR_INTERVAL_KEY])
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIRROR_INTERVAL_MS
}

export async function getLastMirrorSync(): Promise<Date | null> {
  const cfg = await readConfigMap()
  const v = cfg[LAST_SYNC_KEY]
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function isMirrorStale(maxAgeMs = DEFAULT_MIRROR_INTERVAL_MS): Promise<boolean> {
  const last = await getLastMirrorSync()
  if (!last) return true
  return Date.now() - last.getTime() > maxAgeMs
}

type CouchContext = { client: CouchClient; scope: string }

async function buildCouchContext(): Promise<CouchContext | null> {
  const [cfg, creds] = await Promise.all([readConfigMap(), loadCouchCreds()])
  const couchUrl = cfg['couchUrl']
  const dbName = cfg['dbName']
  if (!couchUrl || !dbName || !creds) return null
  return {
    client: new CouchClient({ url: couchUrl, dbName, auth: creds }),
    scope: scopeFor(couchUrl, dbName),
  }
}

/**
 * Sync the local mirror from Couch (delta-only after the first run) and
 * return the projected typed snapshot. Returns null if the user hasn't
 * configured Couch yet.
 */
export async function syncMirror(): Promise<MirrorSnapshot | null> {
  runMigrations()
  const ctx = await buildCouchContext()
  if (!ctx) return null
  const buckets = await refreshCache(ctx.client, ctx.scope)
  await writeConfig(LAST_SYNC_KEY, new Date().toISOString())
  return projectBuckets(buckets)
}

/**
 * Read the cached snapshot straight from SQLite — no network call. Returns an
 * empty snapshot if the mirror hasn't been populated yet.
 */
export async function readMirror(): Promise<MirrorSnapshot | null> {
  runMigrations()
  const ctx = await buildCouchContext()
  if (!ctx) return null
  const rows = await db
    .select({ modelType: couchDocCache.modelType, json: couchDocCache.json })
    .from(couchDocCache)
    .where(eq(couchDocCache.scope, ctx.scope))
  const buckets: DocBucket = new Map()
  for (const row of rows) {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(row.json) as Record<string, unknown> } catch { continue }
    const arr = buckets.get(row.modelType)
    if (arr) arr.push(parsed)
    else buckets.set(row.modelType, [parsed])
  }
  return projectBuckets(buckets)
}

/**
 * If the local cache is stale (or never populated), sync first; otherwise
 * return the local snapshot. Used by RSC pages to keep render latency low.
 */
export async function ensureFreshMirror(maxAgeMs = DEFAULT_MIRROR_INTERVAL_MS): Promise<MirrorSnapshot | null> {
  if (await isMirrorStale(maxAgeMs)) return syncMirror()
  return readMirror()
}

/** Asset transactions plus the trades Wallet holds as fallback Records. */
export function withFallbackTrades(s: MirrorSnapshot): {
  transactions: MirrorAssetTransaction[]
  byAssetId: Map<string, MirrorAsset>
} {
  const exchange = new Map(db.select().from(recordFallback).all().map(r => [r.symbol.toUpperCase(), r.exchange]))
  const fb = fallbackTrades(s.records, sym => exchange.get(sym.toUpperCase()) ?? 'XBSE')
  return {
    transactions: [...s.transactions, ...fb.transactions],
    byAssetId: new Map([...s.byAssetId, ...fb.assets.map(a => [a.id, a] as const)]),
  }
}

function projectBuckets(buckets: DocBucket): MirrorSnapshot {
  const currencyMap = new Map<string, string>()
  for (const raw of buckets.get('Currency') ?? []) {
    const c = raw as { _id?: string; code?: string }
    if (c._id && c.code) currencyMap.set(c._id, c.code)
  }

  const accounts: MirrorAccount[] = []
  for (const raw of buckets.get('Account') ?? []) {
    const a = raw as {
      _id?: string; name?: string; accountType?: number;
      currencyId?: string; investmentInfo?: { assetTypes?: number[] }
      initAmount?: number
      reservedIntegrationConnection?: {
        remoteProviderName?: string; lastSuccessRefresh?: string
        isActive?: boolean; consent?: { granted?: boolean }
      }
    }
    const conn = a.reservedIntegrationConnection
    if (!a._id) continue
    accounts.push({
      id: a._id,
      name: a.name ?? '',
      accountType: a.accountType ?? 0,
      currencyCode: (a.currencyId && currencyMap.get(a.currencyId)) || DEFAULT_BASE_CURRENCY,
      assetTypes: a.investmentInfo?.assetTypes ?? [],
      initAmount: a.initAmount ?? 0,
      bank: conn ? {
        provider: conn.remoteProviderName ?? a.name ?? '',
        lastRefresh: conn.lastSuccessRefresh,
        active: conn.isActive !== false && conn.consent?.granted !== false,
      } : undefined,
    })
  }

  const assets: MirrorAsset[] = []
  for (const raw of buckets.get('StocksFundsAsset') ?? []) {
    const x = raw as {
      _id?: string; symbol?: string; exchangeCode?: string;
      name?: string; currencyCode?: string
    }
    if (!x._id || !x.symbol) continue
    assets.push({
      id: x._id,
      symbol: x.symbol,
      exchangeCode: x.exchangeCode ?? '',
      name: x.name,
      currencyCode: x.currencyCode ?? '',
    })
  }

  const categories: MirrorCategory[] = []
  for (const raw of buckets.get('Category') ?? []) {
    const c = raw as { _id?: string; name?: string; envelopeId?: number }
    if (!c._id) continue
    categories.push({
      id: c._id,
      name: c.name ?? '',
      envelopeId: c.envelopeId,
      groupName: envelopeGroupName(c.envelopeId),
    })
  }

  const transactions: MirrorAssetTransaction[] = []
  for (const raw of buckets.get('AssetTransaction') ?? []) {
    const t = raw as {
      _id?: string; accountId?: string; assetId?: string;
      transactionType?: number; date?: string;
      quantity?: number; price?: number;
      priceCurrencyCode?: string; cashAmount?: number;
      cashAmountCurrencyCode?: string;
    }
    if (!t._id || !t.accountId || !t.assetId || !t.date) continue
    transactions.push({
      id: t._id,
      accountId: t.accountId,
      assetId: t.assetId,
      transactionType: t.transactionType ?? 0,
      date: normalizeDate(t.date),
      quantity: t.quantity ?? 0,
      price: t.price ?? 0,
      priceCurrencyCode: t.priceCurrencyCode,
      cashAmount: t.cashAmount,
      cashAmountCurrencyCode: t.cashAmountCurrencyCode,
    })
  }

  const records: MirrorRecord[] = []
  const categoryById = new Map(categories.map(c => [c.id, c]))
  for (const raw of buckets.get('Record') ?? []) {
    const r = raw as {
      _id?: string; accountId?: string; categoryId?: string;
      amount?: number; type?: number; currencyId?: string;
      recordDate?: string; date?: string; note?: string;
      reservedSource?: string; externalSource?: string;
      transfer?: boolean; transferAccountId?: string;
      reservedIntegrationSource?: string; payee?: string;
    }
    if (!r._id || !r.accountId) continue
    const dateStr = r.recordDate ?? r.date
    if (!dateStr) continue
    const cat = r.categoryId ? categoryById.get(r.categoryId) : undefined
    const isTradeFallback = r.reservedSource === 'wallet-broker-sync'
      && (r.externalSource === 'tradeville' || r.externalSource === 'xtb' || r.externalSource === 'ibkr')
    records.push({
      id: r._id,
      accountId: r.accountId,
      categoryId: r.categoryId,
      categoryName: cat?.name,
      categoryGroupName: cat?.groupName,
      amount: r.amount ?? 0,
      recordType: r.type,
      currencyCode: (r.currencyId && currencyMap.get(r.currencyId)) || '',
      recordDate: normalizeDate(dateStr),
      note: r.note,
      isTradeFallback,
      transfer: r.transfer === true,
      transferAccountId: r.transferAccountId,
      bankSynced: !!r.reservedIntegrationSource,
      payee: r.payee,
    })
  }

  return {
    accounts,
    assets,
    categories,
    transactions,
    records,
    byAssetId: new Map(assets.map(a => [a.id, a])),
    byAccountId: new Map(accounts.map(a => [a.id, a])),
    byCategoryId: categoryById,
  }
}

function normalizeDate(input: string): string {
  // Wallet may store either YYYY-MM-DD or full ISO. Truncate to the date part.
  return input.length >= 10 ? input.slice(0, 10) : input
}
