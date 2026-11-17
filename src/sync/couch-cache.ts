/**
 * SQLite-backed mirror of CouchDB docs we care about (Account, Currency,
 * StocksFundsAsset, Category, AssetTransaction, Record, MagicRule, HashTag). On each refresh we
 * walk the _changes feed from the last persisted seq and apply deltas, so
 * dry-runs after the first one only download what changed.
 */
import { eq, and } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { config, couchDocCache, couchCacheMeta } from '@/src/storage/schema'
import type { CouchClient } from './couch'

export type DocBucket = Map<string, Record<string, unknown>[]>

export const TYPES = ['Account', 'Currency', 'StocksFundsAsset', 'Category', 'AssetTransaction', 'Record', 'MagicRule', 'HashTag'] as const

const TYPES_KEY = 'couchCache.types'
const TYPES_VALUE = TYPES.join(',')

export function scopeFor(couchUrl: string, dbName: string): string {
  return `${couchUrl}|${dbName}`
}

/**
 * Apply _changes since the last persisted seq for this scope, then return the
 * full bucketed snapshot (docs keyed by reservedModelType). First call does a
 * full scan; subsequent calls only fetch the delta.
 */
export async function refreshCache(
  couch: Pick<CouchClient, 'changesSince'>,
  scope: string,
): Promise<DocBucket> {
  const metaRow = await db
    .select()
    .from(couchCacheMeta)
    .where(eq(couchCacheMeta.scope, scope))
    .limit(1)
  // A changed type list needs a full pass: docs of new types sit before the stored seq.
  const typesRow = await db.select().from(config).where(eq(config.key, TYPES_KEY)).limit(1)
  const typesChanged = typesRow[0]?.value !== TYPES_VALUE
  const since: string | number = typesChanged ? 0 : (metaRow[0]?.lastSeq ?? 0)

  let lastSeq: string | number = since
  let upserts = 0
  let deletes = 0
  for await (const change of couch.changesSince(since)) {
    lastSeq = change.seq
    if (change.deleted) {
      const res = await db
        .delete(couchDocCache)
        .where(and(eq(couchDocCache.scope, scope), eq(couchDocCache.docId, change.id)))
      // Drizzle's better-sqlite3 driver doesn't return changes count consistently
      void res
      deletes++
      continue
    }
    if (!change.doc) continue
    const modelType = (change.doc['reservedModelType'] as string) ?? ''
    if (!modelType) continue  // skip docs without a known model type
    if (!TYPES.includes(modelType as (typeof TYPES)[number])) continue  // skip types we don't care about
    const json = JSON.stringify(change.doc)
    await db
      .insert(couchDocCache)
      .values({ scope, docId: change.id, modelType, json })
      .onConflictDoUpdate({
        target: [couchDocCache.scope, couchDocCache.docId],
        set: { modelType, json },
      })
    upserts++
  }

  if (lastSeq !== since) {
    await db
      .insert(couchCacheMeta)
      .values({ scope, lastSeq: String(lastSeq) })
      .onConflictDoUpdate({
        target: couchCacheMeta.scope,
        set: { lastSeq: String(lastSeq) },
      })
  }

  if (typesChanged) {
    await db.insert(config).values({ key: TYPES_KEY, value: TYPES_VALUE })
      .onConflictDoUpdate({ target: config.key, set: { value: TYPES_VALUE } })
  }

  void upserts; void deletes  // useful for log/debug; intentionally unused

  // Read the full snapshot back from the cache, bucketed by model type.
  const rows = await db
    .select({ modelType: couchDocCache.modelType, json: couchDocCache.json })
    .from(couchDocCache)
    .where(eq(couchDocCache.scope, scope))

  const buckets: DocBucket = new Map()
  for (const t of TYPES) buckets.set(t, [])
  for (const row of rows) {
    const arr = buckets.get(row.modelType)
    if (!arr) continue  // type was added/removed since cache was populated
    try {
      arr.push(JSON.parse(row.json) as Record<string, unknown>)
    } catch {
      // Corrupted row — skip; will be rewritten by the next change for this id.
    }
  }
  return buckets
}

/**
 * Drop all cached docs and the seq cursor for this scope. Forces the next
 * refresh to do a full scan.
 */
export async function invalidateCache(scope: string): Promise<void> {
  await db.delete(couchDocCache).where(eq(couchDocCache.scope, scope))
  await db.delete(couchCacheMeta).where(eq(couchCacheMeta.scope, scope))
}
