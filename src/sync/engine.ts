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

export type SyncResult = {
  total: number; inserted: number; conflict: number
  errors: Array<{ id: string; reason: string }>
  needsAsset: CanonicalTxn[]
  unsupported: UnsupportedRow[]
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
 * Steps 1-6: read existing docs, diff, build AssetTransactionDocs.
 * Does NOT write anything to CouchDB.
 */
export async function prepareSync(
  input: Omit<SyncInput, 'couch'> & { couch: Pick<CouchClient, 'listAssetTransactions'> },
): Promise<PreparedSync> {
  const existing = await input.couch.listAssetTransactions(input.accountId)
  const existingIds = new Set(existing.map((d: Record<string, unknown>) => d['_id']))
  const now = new Date().toISOString()

  const toInsert: PreparedDoc[] = []
  const alreadyPresent: string[] = []
  const needsAsset: CanonicalTxn[] = []

  for (const t of input.txns) {
    if (t.kind === 'fee') continue
    if (!t.exchange || !t.symbol) { needsAsset.push(t); continue }
    const assetId = input.lookup.assetByVenueSymbol(t.exchange, t.symbol)
    if (!assetId) { needsAsset.push(t); continue }
    const doc = toAssetTransactionDoc(t, {
      accountId: input.accountId, assetId,
      ownerId: input.ownerId, now, toolVersion: input.toolVersion,
    })
    if (existingIds.has(doc._id)) alreadyPresent.push(doc._id)
    else toInsert.push({ doc, source: t })
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

  for (let i = 0; i < prepared.toInsert.length; i += 50) {
    const batch = prepared.toInsert.slice(i, i + 50).map(p => p.doc)
    const res = await couch.bulkDocs(batch)
    for (const r of res) {
      if (r.status === 'inserted') inserted++
      else if (r.status === 'conflict') conflict++
      else errors.push({ id: r.id, reason: (r as { id: string; status: string; reason?: string }).reason ?? 'unknown' })
    }
  }

  return {
    total: prepared.total,
    inserted, conflict, errors,
    needsAsset: prepared.needsAsset,
    unsupported: prepared.unsupported,
    preview: { new: prepared.toInsert, alreadyPresent: prepared.alreadyPresent },
  }
}

export async function runSync(input: SyncInput): Promise<SyncResult> {
  const prepared = await prepareSync(input)
  return commitSync(prepared, input.couch)
}
