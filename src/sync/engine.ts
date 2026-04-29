import type { CanonicalTxn } from '@/src/types'
import type { CouchClient } from './couch'
import type { LookupService } from './lookup'
import type { UnsupportedRow } from '@/src/parsers/types'
import { toAssetTransactionDoc, type AssetTransactionDoc } from './mapper'
import { toRecordDoc, toRecordDocFromTrade, type RecordDoc } from './record-mapper'

export type SyncInput = {
  broker: string; txns: CanonicalTxn[]; unsupported: UnsupportedRow[]
  accountId: string; ownerId: string; toolVersion: string
  couch: Pick<CouchClient, 'listAssetTransactions' | 'listRecords' | 'bulkDocs'>
  lookup: Pick<LookupService, 'assetByVenueSymbol' | 'assetById' | 'categoryByName' | 'currencyByCode'>
  /** 'broker:exchange:symbol' (uppercased) — trades for these combos build a Record instead of AssetTransaction */
  recordFallback?: Set<string>
  /** 'broker:externalId' → existingDocId — these txns are treated as already-present */
  manualLink?: Map<string, string>
}

/** Pair the wire doc (what gets written) with its source canonical txn (for UI display). */
export type PreparedDoc = { doc: AssetTransactionDoc; source: CanonicalTxn }

/** Pair a Record doc with its source canonical txn (dividends/fees). */
export type PreparedRecord = { doc: RecordDoc; source: CanonicalTxn }

export type NearMatch = {
  docId: string
  date: string             // ISO from existing doc
  assetId: string
  symbol?: string          // resolved from LookupService.assetById
  exchange?: string        // resolved from LookupService.assetById (exchangeCode)
  transactionType: number  // 0 buy, 1 sell
  quantity: number
  price: number            // int × 100 from existing doc
  priceCurrencyCode?: string
  cashAmount?: number      // dec × 100
  cashAmountCurrencyCode?: string
}

/** Per-doc outcome from the bulk write step. Lets the audit log report accurately. */
export type WriteOutcome =
  | { docId: string; externalId: string; status: 'inserted'; rev: string }
  | { docId: string; externalId: string; status: 'conflict' }
  | { docId: string; externalId: string; status: 'error'; reason: string }

export type SyncResult = {
  total: number; inserted: number; conflict: number
  errors: Array<{ id: string; reason: string }>
  needsAsset: CanonicalTxn[]
  unsupported: UnsupportedRow[]
  outcomes: WriteOutcome[]
  recordsInserted: number
  recordsConflict: number
  recordOutcomes: WriteOutcome[]
  preview: {
    new: PreparedDoc[]
    alreadyPresent: string[]
    nearMatches: Record<string, NearMatch[]>
    unmatchedExisting: NearMatch[]
    newRecords: PreparedRecord[]
    alreadyPresentRecords: string[]
  }
}

export type PreparedSync = {
  toInsert: PreparedDoc[]
  alreadyPresent: string[]
  nearMatches: Record<string, NearMatch[]>   // ourDocId → candidates
  unmatchedExisting: NearMatch[]             // ALL existing docs not in alreadyPresent (sorted by date desc)
  needsAsset: CanonicalTxn[]
  unsupported: UnsupportedRow[]
  total: number
  recordsToInsert: PreparedRecord[]
  alreadyPresentRecords: string[]
  skippedRecords: Array<{ txn: CanonicalTxn; reason: string }>
}

/**
 * Build a content key for STRICT dedup against existing docs. Uses
 * (assetId, transactionType, day-of-date, quantity, price).
 *
 * Strict means: when this key matches, we're confident it's the same
 * trade and silently skip it. Cases where price drifts by ~1 cent
 * between broker statement and manual entry won't strict-match here —
 * those fall through to `nearMatches` where the user manually links
 * via the preview dropdown.
 *
 * Quantity and price are stringified via Number().toString() so JSON
 * deserialization and parser output produce identical keys.
 */
function contentKey(doc: {
  assetId?: string; transactionType?: number; date?: string; quantity?: number; price?: number
}): string {
  const q = doc.quantity == null ? '' : Number(doc.quantity).toString()
  const p = doc.price == null ? '' : Number(doc.price).toString()
  return [
    doc.assetId ?? '',
    String(doc.transactionType ?? ''),
    (doc.date ?? '').slice(0, 10),
    q,
    p,
  ].join('|')
}

/** Pick a categoryId for a dividend or fee CanonicalTxn. Returns null when no category resolves. */
function pickCategoryId(t: CanonicalTxn, lookup: Pick<LookupService, 'categoryByName'>): string | null {
  if (t.kind === 'dividend') {
    return lookup.categoryByName('Income') ?? lookup.categoryByName('Investment') ?? null
  }
  if (t.kind === 'fee') {
    return lookup.categoryByName('Others') ?? lookup.categoryByName('Bank fees') ?? null
  }
  return null
}

/**
 * Steps 1-6: read existing docs, diff, build AssetTransactionDocs and RecordDocs.
 * Does NOT write anything to CouchDB.
 */
export async function prepareSync(
  input: Omit<SyncInput, 'couch'> & {
    couch: Pick<CouchClient, 'listAssetTransactions' | 'listRecords'>
    lookup: Pick<LookupService, 'assetByVenueSymbol' | 'assetById' | 'categoryByName' | 'currencyByCode'>
    recordFallback?: Set<string>
    manualLink?: Map<string, string>
  },
): Promise<PreparedSync> {
  const [existing, existingRecords] = await Promise.all([
    input.couch.listAssetTransactions(input.accountId),
    input.couch.listRecords(input.accountId),
  ])
  const existingIds = new Set(existing.map((d: Record<string, unknown>) => d['_id']))

  // Second-pass content map: catches manually-entered docs with random _ids
  // that share the same trade fields as our deterministic-_id docs.
  const existingByContent = new Map<string, string>()  // contentKey → existing _id
  for (const d of existing) {
    existingByContent.set(contentKey(d as Parameters<typeof contentKey>[0]), d['_id'] as string)
  }

  // Index existing by (assetId, transactionType, day) for near-match lookup
  const existingByDayKey = new Map<string, Array<Record<string, unknown>>>()
  for (const d of existing) {
    const key = `${d['assetId'] ?? ''}|${d['transactionType'] ?? ''}|${(d['date'] as string ?? '').slice(0, 10)}`
    if (!existingByDayKey.has(key)) existingByDayKey.set(key, [])
    existingByDayKey.get(key)!.push(d)
  }

  const now = new Date().toISOString()

  const recordFallback = input.recordFallback ?? new Set<string>()
  const manualLink = input.manualLink ?? new Map<string, string>()

  const toInsert: PreparedDoc[] = []
  const alreadyPresent: string[] = []
  const needsAsset: CanonicalTxn[] = []

  // Record dedup: deterministic _id is sufficient (Records rarely get manually entered)
  const existingRecordIds = new Set(existingRecords.map((d: Record<string, unknown>) => d['_id']))
  const recordsToInsert: PreparedRecord[] = []
  const alreadyPresentRecords: string[] = []
  const skippedRecords: Array<{ txn: CanonicalTxn; reason: string }> = []

  for (const t of input.txns) {
    // Manual link check: treat as already-present without inserting anything.
    const manualKey = `${t.broker}:${t.externalId}`
    if (manualLink.has(manualKey)) {
      alreadyPresent.push(manualLink.get(manualKey)!)
      continue
    }

    if (t.kind === 'dividend' || t.kind === 'fee') {
      const categoryId = pickCategoryId(t, input.lookup)
      const currencyId = input.lookup.currencyByCode(t.settlementCurrency)
      if (!categoryId) {
        skippedRecords.push({ txn: t, reason: `no matching category for ${t.kind} (need "Income"/"Investment" for dividends or "Others"/"Bank fees" for fees)` })
        continue
      }
      if (!currencyId) {
        skippedRecords.push({ txn: t, reason: `currency "${t.settlementCurrency}" not found in Wallet` })
        continue
      }
      const doc = toRecordDoc(t, {
        accountId: input.accountId, categoryId, currencyId,
        ownerId: input.ownerId, now, toolVersion: input.toolVersion,
      })
      if (existingRecordIds.has(doc._id)) {
        alreadyPresentRecords.push(doc._id)
      } else {
        recordsToInsert.push({ doc, source: t })
      }
      continue
    }

    if (!t.exchange || !t.symbol) { needsAsset.push(t); continue }
    const assetId = input.lookup.assetByVenueSymbol(t.exchange, t.symbol, t.tradeCurrency, input.broker)
    if (!assetId) {
      // Record-fallback: if this (broker, exchange, symbol) combo is marked, build a Record instead.
      const fallbackKey = `${t.broker}:${t.exchange.toUpperCase()}:${t.symbol.toUpperCase()}`
      if (recordFallback.has(fallbackKey)) {
        // Use the category for "Others" (expense for buys) or "Income" (income for sells).
        // Prefer the same categories as fees/dividends respectively.
        const categoryId = t.kind === 'buy'
          ? (input.lookup.categoryByName('Others') ?? input.lookup.categoryByName('Bank fees') ?? null)
          : (input.lookup.categoryByName('Income') ?? input.lookup.categoryByName('Investment') ?? null)
        // Use tradeCurrency if available, fall back to settlementCurrency.
        const currencyCode = t.tradeCurrency ?? t.settlementCurrency
        const currencyId = input.lookup.currencyByCode(currencyCode)
        if (!categoryId || !currencyId) {
          skippedRecords.push({
            txn: t,
            reason: `record-fallback for ${t.symbol}: ${!categoryId ? 'no matching category' : `currency "${currencyCode}" not found`}`,
          })
          continue
        }
        const doc = toRecordDocFromTrade(t, {
          accountId: input.accountId, categoryId, currencyId,
          ownerId: input.ownerId, now, toolVersion: input.toolVersion,
        })
        if (existingRecordIds.has(doc._id)) {
          alreadyPresentRecords.push(doc._id)
        } else {
          recordsToInsert.push({ doc, source: t })
        }
        continue
      }
      needsAsset.push(t)
      continue
    }
    const doc = toAssetTransactionDoc(t, {
      accountId: input.accountId, assetId,
      ownerId: input.ownerId, now, toolVersion: input.toolVersion,
    })
    const ourKey = contentKey(doc)
    if (existingIds.has(doc._id)) {
      alreadyPresent.push(doc._id)
    } else if (existingByContent.has(ourKey)) {
      // Content-match against a manually-entered (or differently-_id'd) existing doc.
      // Push the EXISTING _id so the preview shows what's already in Wallet.
      alreadyPresent.push(existingByContent.get(ourKey)!)
    } else {
      toInsert.push({ doc, source: t })
    }
  }

  // Resolve asset metadata for a doc using the lookup service.
  const enrich = (d: Record<string, unknown>): NearMatch => {
    const assetId = d['assetId'] as string
    const meta = input.lookup.assetById?.(assetId) ?? null
    return {
      docId: d['_id'] as string,
      date: d['date'] as string,
      assetId,
      symbol: meta?.symbol,
      exchange: meta?.exchangeCode,
      transactionType: Number(d['transactionType']),
      quantity: d['quantity'] as number,
      price: d['price'] as number,
      priceCurrencyCode: d['priceCurrencyCode'] as string | undefined,
      cashAmount: d['cashAmount'] as number | undefined,
      cashAmountCurrencyCode: d['cashAmountCurrencyCode'] as string | undefined,
    }
  }

  // Existing docs not auto-matched, sorted by date desc
  const unmatchedExisting: NearMatch[] = existing
    .filter(d => !alreadyPresent.includes(d['_id'] as string))
    .map(enrich)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  // Build nearMatches for each toInsert doc
  const nearMatches: Record<string, NearMatch[]> = {}
  for (const p of toInsert) {
    const dayKey = `${p.doc.assetId}|${p.doc.transactionType}|${p.doc.date.slice(0, 10)}`
    const candidates = (existingByDayKey.get(dayKey) ?? [])
      // Exclude docs that are ALREADY in alreadyPresent (don't suggest as link target)
      .filter(d => !alreadyPresent.includes(d['_id'] as string))
      // Defensive: ensure transactionType matches after Number() coercion
      // (guards against CouchDB serialization returning a string instead of a number)
      .filter(d => Number(d['transactionType']) === p.doc.transactionType)
    if (candidates.length === 0) continue
    // Sort by quantity-closeness, then by date-closeness
    const sorted = [...candidates].sort((a, b) => {
      const da = Math.abs((a['quantity'] as number) - p.doc.quantity)
      const db = Math.abs((b['quantity'] as number) - p.doc.quantity)
      return da - db
    })
    nearMatches[p.doc._id] = sorted.map(enrich)
  }

  return {
    toInsert, alreadyPresent, nearMatches, unmatchedExisting,
    needsAsset, unsupported: input.unsupported, total: input.txns.length,
    recordsToInsert, alreadyPresentRecords, skippedRecords,
  }
}

async function bulkWriteDocs(
  items: Array<{ doc: { _id: string; externalId: string } }>,
  couch: Pick<CouchClient, 'bulkDocs'>,
): Promise<{ inserted: number; conflict: number; errors: SyncResult['errors']; outcomes: WriteOutcome[] }> {
  let inserted = 0, conflict = 0
  const errors: SyncResult['errors'] = []
  const outcomes: WriteOutcome[] = []

  const externalIdById = new Map<string, string>()
  for (const p of items) externalIdById.set(p.doc._id, p.doc.externalId)

  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50).map(p => p.doc as unknown as Record<string, unknown>)
    const res = await couch.bulkDocs(batch)
    for (const r of res) {
      const externalId = externalIdById.get(r.id) ?? ''
      if (r.status === 'inserted') {
        inserted++
        outcomes.push({ docId: r.id, externalId, status: 'inserted', rev: r.rev })
      } else if (r.status === 'conflict') {
        conflict++
        outcomes.push({ docId: r.id, externalId, status: 'conflict' })
      } else {
        const reason = (r as { id: string; status: string; reason?: string }).reason ?? 'unknown'
        errors.push({ id: r.id, reason })
        outcomes.push({ docId: r.id, externalId, status: 'error', reason })
      }
    }
  }
  return { inserted, conflict, errors, outcomes }
}

/**
 * Commit step: writes prepared AssetTransaction and Record docs to CouchDB via bulkDocs.
 */
export async function commitSync(
  prepared: PreparedSync,
  couch: Pick<CouchClient, 'bulkDocs'>,
): Promise<SyncResult> {
  const txnResult = await bulkWriteDocs(prepared.toInsert, couch)
  const recordResult = await bulkWriteDocs(prepared.recordsToInsert, couch)

  return {
    total: prepared.total,
    inserted: txnResult.inserted,
    conflict: txnResult.conflict,
    errors: [...txnResult.errors, ...recordResult.errors],
    needsAsset: prepared.needsAsset,
    unsupported: prepared.unsupported,
    outcomes: txnResult.outcomes,
    recordsInserted: recordResult.inserted,
    recordsConflict: recordResult.conflict,
    recordOutcomes: recordResult.outcomes,
    preview: {
      new: prepared.toInsert,
      alreadyPresent: prepared.alreadyPresent,
      nearMatches: prepared.nearMatches,
      unmatchedExisting: prepared.unmatchedExisting,
      newRecords: prepared.recordsToInsert,
      alreadyPresentRecords: prepared.alreadyPresentRecords,
    },
  }
}

export async function runSync(input: SyncInput): Promise<SyncResult> {
  const prepared = await prepareSync(input)
  return commitSync(prepared, input.couch)
}
