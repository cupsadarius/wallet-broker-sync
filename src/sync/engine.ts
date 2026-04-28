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

export type SyncResult = {
  total: number; inserted: number; conflict: number
  errors: Array<{ id: string; reason: string }>
  needsAsset: CanonicalTxn[]
  unsupported: UnsupportedRow[]
  preview: { new: AssetTransactionDoc[]; alreadyPresent: string[] }
}

export async function runSync(input: SyncInput): Promise<SyncResult> {
  const existing = await input.couch.listAssetTransactions(input.accountId)
  const existingIds = new Set(existing.map((d: Record<string, unknown>) => d['_id']))
  const now = new Date().toISOString()

  const toInsert: AssetTransactionDoc[] = []
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
    else toInsert.push(doc)
  }

  let inserted = 0, conflict = 0
  const errors: SyncResult['errors'] = []
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50)
    const res = await input.couch.bulkDocs(batch)
    for (const r of res) {
      if (r.status === 'inserted') inserted++
      else if (r.status === 'conflict') conflict++
      else errors.push({ id: r.id, reason: (r as { id: string; status: string; reason?: string }).reason ?? 'unknown' })
    }
  }

  return {
    total: input.txns.length,
    inserted, conflict, errors,
    needsAsset, unsupported: input.unsupported,
    preview: { new: toInsert, alreadyPresent },
  }
}
