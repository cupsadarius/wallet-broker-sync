import type { CanonicalTxn } from '@/src/types'
import type { CouchClient } from './couch'
import type { LookupService } from './lookup'
import type { UnsupportedRow } from '@/src/parsers/types'
import { toAssetTransactionDoc, type AssetTransactionDoc } from './mapper'

export type SyncInput = {
  broker: string; txns: CanonicalTxn[]; unsupported: UnsupportedRow[]
  accountId: string; ownerId: string; toolVersion: string
  couch: Pick<CouchClient, 'listAssetTransactions' | 'bulkDocs'>
  lookup: Pick<LookupService, 'assetByVenueSymbol'>
}

/** Pair the wire doc (what gets written) with its source canonical txn (for UI display). */
export type PreparedDoc = { doc: AssetTransactionDoc; source: CanonicalTxn }

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
  preview: { new: PreparedDoc[]; alreadyPresent: string[] }
}

export type PreparedSync = {
  toInsert: PreparedDoc[]
  alreadyPresent: string[]
  needsAsset: CanonicalTxn[]
  unsupported: UnsupportedRow[]
  total: number
}

/**
 * Build a content key for dedup against manually-entered existing docs.
 * Uses (assetId, transactionType, day-of-date, quantity).
 *
 * Price is intentionally NOT in the key. Broker statements and manual
 * Wallet entries routinely disagree by ~1 cent due to display rounding
 * (e.g. IBKR statement: $112.00 → 11200, manual entry stores 11199).
 * Two trades of the same asset on the same day with the same exact
 * quantity but different prices are extremely rare — accepting that
 * narrow false-positive risk to actually catch manual duplicates.
 *
 * Quantity is normalized via Number().toString() so 0.511 from a JSON
 * doc and 0.511 from a parser produce the same key.
 */
function contentKey(doc: {
  assetId?: string; transactionType?: number; date?: string; quantity?: number
}): string {
  const q = doc.quantity == null ? '' : Number(doc.quantity).toString()
  return [
    doc.assetId ?? '',
    String(doc.transactionType ?? ''),
    (doc.date ?? '').slice(0, 10),
    q,
  ].join('|')
}

/**
 * Steps 1-6: read existing docs, diff, build AssetTransactionDocs.
 * Does NOT write anything to CouchDB.
 */
export async function prepareSync(
  input: Omit<SyncInput, 'couch'> & { couch: Pick<CouchClient, 'listAssetTransactions'> },
): Promise<PreparedSync> {
  const existing = await input.couch.listAssetTransactions(input.accountId)
  const existingIds = new Set(existing.map((d: Record<string, unknown>) => d['_id']))

  // Second-pass content map: catches manually-entered docs with random _ids
  // that share the same trade fields as our deterministic-_id docs.
  const existingByContent = new Map<string, string>()  // contentKey → existing _id
  for (const d of existing) {
    existingByContent.set(contentKey(d as Parameters<typeof contentKey>[0]), d['_id'] as string)
  }

  const now = new Date().toISOString()

  const toInsert: PreparedDoc[] = []
  const alreadyPresent: string[] = []
  const needsAsset: CanonicalTxn[] = []

  for (const t of input.txns) {
    if (t.kind === 'fee') continue
    if (!t.exchange || !t.symbol) { needsAsset.push(t); continue }
    const assetId = input.lookup.assetByVenueSymbol(t.exchange, t.symbol, t.tradeCurrency, input.broker)
    if (!assetId) { needsAsset.push(t); continue }
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

  return { toInsert, alreadyPresent, needsAsset, unsupported: input.unsupported, total: input.txns.length }
}

/**
 * Commit step: writes prepared docs to CouchDB via bulkDocs.
 */
export async function commitSync(
  prepared: PreparedSync,
  couch: Pick<CouchClient, 'bulkDocs'>,
): Promise<SyncResult> {
  let inserted = 0, conflict = 0
  const errors: SyncResult['errors'] = []
  const outcomes: WriteOutcome[] = []

  // Build a quick map from _id → externalId so per-doc outcomes carry both.
  const externalIdById = new Map<string, string>()
  for (const p of prepared.toInsert) externalIdById.set(p.doc._id, p.doc.externalId)

  for (let i = 0; i < prepared.toInsert.length; i += 50) {
    const batch = prepared.toInsert.slice(i, i + 50).map(p => p.doc)
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

  return {
    total: prepared.total,
    inserted, conflict, errors,
    needsAsset: prepared.needsAsset,
    unsupported: prepared.unsupported,
    outcomes,
    preview: { new: prepared.toInsert, alreadyPresent: prepared.alreadyPresent },
  }
}

export async function runSync(input: SyncInput): Promise<SyncResult> {
  const prepared = await prepareSync(input)
  return commitSync(prepared, input.couch)
}
