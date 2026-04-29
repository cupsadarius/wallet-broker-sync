import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, runMigrations } from '@/src/storage/db'
import { config, brokerAccountMap, syncRun, syncRunDoc, assetAlias, recordFallback as recordFallbackTable, manualLink as manualLinkTable } from '@/src/storage/schema'
import { loadCouchCreds } from '@/src/storage/credentials'
import { CouchClient } from '@/src/sync/couch'
import { LookupService } from '@/src/sync/lookup'
import { prepareSync, commitSync, type PreparedSync } from '@/src/sync/engine'
import { refreshCache, scopeFor } from '@/src/sync/couch-cache'
import { parsers } from '@/src/parsers/registry'
import { formatError } from '@/src/sync/format-error'

runMigrations()

const TOOL_VERSION = '1.0.0'
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024  // 10 MB — XTB exports are typically <500KB; IBKR statements can be larger

const BrokerSchema = z.enum(['xtb', 'ibkr', 'tradeville'])

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const dryRun = url.searchParams.get('dryRun') === 'true'

    // Hard cap on body size to prevent OOM from large/hostile uploads.
    const lenHeader = req.headers.get('content-length')
    if (lenHeader && Number(lenHeader) > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: `upload exceeds ${MAX_UPLOAD_BYTES} bytes` }, { status: 413 })
    }

    // Parse multipart form
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ ok: false, error: 'expected multipart/form-data' }, { status: 400 })
    }

    const fileEntries = formData.getAll('file').filter((e): e is File => e instanceof File)
    const brokerEntry = formData.get('broker')

    if (fileEntries.length === 0) {
      return NextResponse.json({ ok: false, error: 'missing file field' }, { status: 400 })
    }

    // Belt-and-suspenders: per-file cap (Content-Length can be absent for streamed bodies)
    for (const f of fileEntries) {
      if (f.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ ok: false, error: `"${f.name}" exceeds ${MAX_UPLOAD_BYTES} bytes` }, { status: 413 })
      }
    }

    const brokerParsed = BrokerSchema.safeParse(brokerEntry)
    if (!brokerParsed.success) {
      return NextResponse.json(
        { ok: false, error: 'broker must be one of: xtb, ibkr, tradeville' },
        { status: 400 },
      )
    }
    const broker = brokerParsed.data

    // Load creds + config
    const creds = await loadCouchCreds()
    if (!creds) {
      return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 400 })
    }

    const rows = await db.select().from(config)
    const configMap = Object.fromEntries(rows.map(r => [r.key, r.value]))
    const couchUrl = configMap['couchUrl']
    const dbName = configMap['dbName']

    if (!couchUrl || !dbName) {
      return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 400 })
    }

    // Load broker account mapping
    const mappingRows = await db.select().from(brokerAccountMap).where(eq(brokerAccountMap.broker, broker))
    const brokerMapping = mappingRows[0]
    if (!brokerMapping) {
      return NextResponse.json(
        { ok: false, error: `no account mapping configured for broker: ${broker}` },
        { status: 400 },
      )
    }

    // Read file bytes + compute sha256 per file
    const parser = parsers[broker]
    if (!parser) {
      return NextResponse.json({ ok: false, error: `no parser for broker: ${broker}` }, { status: 400 })
    }

    const perFile: Array<{ filename: string; sha256: string; size: number }> = []
    const allTxns: import('@/src/types').CanonicalTxn[] = []
    const allUnsupported: import('@/src/parsers/types').UnsupportedRow[] = []

    for (const f of fileEntries) {
      const arrayBuffer = await f.arrayBuffer()
      const buf = Buffer.from(arrayBuffer)
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
      const filename = f.name ?? 'upload'
      const bytes = new Uint8Array(buf)
      const parsed = await parser.parse({ bytes, filename })
      allTxns.push(...parsed.txns)
      allUnsupported.push(...parsed.unsupported)
      perFile.push({ filename, sha256, size: f.size })
    }

    // Dedup transactions by externalId — overlapping yearly statements produce the same id
    const seenExternal = new Set<string>()
    const txns: import('@/src/types').CanonicalTxn[] = []
    for (const t of allTxns) {
      if (seenExternal.has(t.externalId)) continue
      seenExternal.add(t.externalId)
      txns.push(t)
    }
    const unsupported = allUnsupported

    // For audit log: combine filenames and hash the per-file sha256s
    const filename = perFile.map(f => f.filename).join(', ')
    const sha256 = crypto.createHash('sha256').update(perFile.map(f => f.sha256).sort().join('|')).digest('hex')

    // Build CouchClient + LookupService
    const couch = new CouchClient({ url: couchUrl, dbName, auth: creds })
    const lookup = new LookupService(couch)
    const aliasRows = await db.select().from(assetAlias)
    lookup.setAliases(aliasRows)

    // Refresh the local mirror via _changes since last seq, then populate
    // lookup + filter out per-account existing docs from the same snapshot.
    // First call is a full scan; subsequent calls are delta-only.
    const cacheScope = scopeFor(couchUrl, dbName)
    const buckets = await refreshCache(couch, cacheScope)
    lookup.populateFromBuckets(buckets)
    const accountId = brokerMapping.accountId
    const existingAssetTxns = (buckets.get('AssetTransaction') ?? []).filter(d => d['accountId'] === accountId)
    const existingRecords = (buckets.get('Record') ?? []).filter(d => d['accountId'] === accountId)

    // Load record-fallback rules and manual links from SQLite
    const [fallbackRows, linkRows] = await Promise.all([
      db.select().from(recordFallbackTable),
      db.select().from(manualLinkTable),
    ])
    const recordFallbackSet = new Set(
      fallbackRows.map(r => `${r.broker}:${r.exchange.toUpperCase()}:${r.symbol.toUpperCase()}`),
    )
    // Multiple rows can share the same (broker, externalId) when a single broker
    // trade is linked to several Wallet entries (e.g. partial-fill grouping).
    const manualLinkMap = new Map<string, string[]>()
    for (const r of linkRows) {
      const key = `${r.broker}:${r.externalId}`
      const existing = manualLinkMap.get(key)
      if (existing) existing.push(r.existingDocId)
      else manualLinkMap.set(key, [r.existingDocId])
    }

    const syncInput = {
      broker,
      txns,
      unsupported,
      accountId,
      ownerId: creds.login,
      toolVersion: TOOL_VERSION,
      couch,
      lookup,
      recordFallback: recordFallbackSet,
      manualLink: manualLinkMap,
      existingAssetTxns,
      existingRecords,
    }

    if (dryRun) {
      const prepared = await prepareSync(syncInput)
      return NextResponse.json({
        inserted: 0,
        conflict: 0,
        recordsInserted: 0,
        recordsConflict: 0,
        preview: {
          new: prepared.toInsert,
          alreadyPresent: prepared.alreadyPresent,
          alreadyPresentDetails: prepared.alreadyPresentDetails,
          nearMatches: prepared.nearMatches,
          unmatchedExisting: prepared.unmatchedExisting,
          newRecords: prepared.recordsToInsert,
          alreadyPresentRecords: prepared.alreadyPresentRecords,
        },
        needsAsset: prepared.needsAsset,
        unsupported: prepared.unsupported,
        skippedRecords: prepared.skippedRecords,
      })
    }

    // Parse skip map: ourDocId → existingDocId[] (one broker trade may link to
    // multiple Wallet entries, e.g. partial fills the user merged manually).
    const skipRaw = formData.get('skip')
    const skipMap: Record<string, string[]> = {}
    if (typeof skipRaw === 'string' && skipRaw) {
      try {
        const parsed = JSON.parse(skipRaw) as Record<string, string | string[]>
        for (const [k, v] of Object.entries(parsed)) {
          // Tolerate the old single-string shape for compat, normalize to array.
          skipMap[k] = Array.isArray(v) ? v : [v]
        }
      } catch { /* ignore bad JSON */ }
    }

    // Full sync
    const startedAt = Date.now()
    const prepared = await prepareSync(syncInput)

    // Filter prepared.toInsert: drop any whose _id is in skipMap
    const skippedDocIds = new Set(Object.keys(skipMap))
    const filteredToInsert = prepared.toInsert.filter(p => !skippedDocIds.has(p.doc._id))
    const linkedExistingIds = Object.values(skipMap)
      .flat()
      .filter(id => !prepared.alreadyPresent.includes(id))

    const filteredPrepared: PreparedSync = {
      ...prepared,
      toInsert: filteredToInsert,
      alreadyPresent: [...prepared.alreadyPresent, ...linkedExistingIds],
    }

    const result = await commitSync(filteredPrepared, couch)
    const finishedAt = Date.now()

    // Persist any user-chosen link selections as manual_link rows so they survive re-import.
    // skipMap: ourDocId → existingDocId[].  One row per linked existing doc.
    if (Object.keys(skipMap).length > 0) {
      const docIdToSource = new Map<string, { broker: string; externalId: string }>()
      for (const p of prepared.toInsert) {
        docIdToSource.set(p.doc._id, { broker: p.source.broker, externalId: p.source.externalId })
      }
      const persistRows: Array<{ broker: string; externalId: string; existingDocId: string }> = []
      for (const [ourDocId, existingDocIds] of Object.entries(skipMap)) {
        const src = docIdToSource.get(ourDocId)
        if (!src) continue
        for (const existingDocId of existingDocIds) {
          persistRows.push({ broker: src.broker, externalId: src.externalId, existingDocId })
        }
      }
      if (persistRows.length > 0) {
        await db.insert(manualLinkTable).values(persistRows).onConflictDoNothing()
      }
    }

    // Persist sync run to SQLite — counts include both AssetTransactions and Records,
    // so the history view reflects everything that hit Wallet.
    const [runRow] = await db.insert(syncRun).values({
      startedAt,
      finishedAt,
      broker,
      accountId: brokerMapping.accountId,
      sourceFilename: filename,
      sourceSha256: sha256,
      parsedCount: result.total,
      insertedCount: result.inserted + result.recordsInserted,
      conflictCount: result.conflict + result.recordsConflict,
      errorCount: result.errors.length,
    }).returning()

    if (runRow) {
      // Single source of truth for per-doc status: the engine's write outcomes.
      // result.errors duplicates the 'error' rows from outcomes — don't re-add them.
      const docRows = [
        ...result.outcomes.map(o => ({
          runId: runRow.id,
          externalId: o.externalId || null,
          docId: o.docId,
          status: o.status,
          errorMessage: o.status === 'error' ? o.reason : null,
        })),
        ...result.recordOutcomes.map(o => ({
          runId: runRow.id,
          externalId: o.externalId || null,
          docId: o.docId,
          status: o.status,
          errorMessage: o.status === 'error' ? o.reason : null,
        })),
        ...result.preview.alreadyPresent.map(id => ({
          runId: runRow.id,
          externalId: null,
          docId: id,
          status: 'skipped',
          errorMessage: null,
        })),
        ...result.preview.alreadyPresentRecords.map(id => ({
          runId: runRow.id,
          externalId: null,
          docId: id,
          status: 'skipped',
          errorMessage: null,
        })),
      ]
      if (docRows.length > 0) {
        await db.insert(syncRunDoc).values(docRows)
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    const f = formatError(err)
    console.error('[api/sync]', f.kind, f.message, f.details)
    const status = f.kind === 'unauthorized' ? 401 : f.kind === 'rate_limited' ? 429 : 500
    return NextResponse.json({ ok: false, error: f.message, kind: f.kind }, { status })
  }
}
