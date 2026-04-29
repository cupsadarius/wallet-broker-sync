import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, runMigrations } from '@/src/storage/db'
import { config, brokerAccountMap, syncRun, syncRunDoc, assetAlias } from '@/src/storage/schema'
import { loadCouchCreds } from '@/src/storage/credentials'
import { CouchClient } from '@/src/sync/couch'
import { LookupService } from '@/src/sync/lookup'
import { prepareSync, commitSync } from '@/src/sync/engine'
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

    const fileEntry = formData.get('file')
    const brokerEntry = formData.get('broker')

    if (!fileEntry || !(fileEntry instanceof File)) {
      return NextResponse.json({ ok: false, error: 'missing file field' }, { status: 400 })
    }

    // Belt-and-suspenders: also check size after multipart decode (Content-Length can be absent for streamed bodies)
    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: `upload exceeds ${MAX_UPLOAD_BYTES} bytes` }, { status: 413 })
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

    // Read file bytes + compute sha256
    const arrayBuffer = await fileEntry.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    const filename = fileEntry.name ?? 'upload'

    // Parse the file
    const parser = parsers[broker]
    if (!parser) {
      return NextResponse.json({ ok: false, error: `no parser for broker: ${broker}` }, { status: 400 })
    }

    const bytes = new Uint8Array(buf)
    const { txns, unsupported } = parser.parse({ bytes, filename })

    // Build CouchClient + LookupService
    const couch = new CouchClient({ url: couchUrl, dbName, auth: creds })
    const lookup = new LookupService(couch)
    const aliasRows = await db.select().from(assetAlias)
    lookup.setAliases(aliasRows)
    await lookup.refresh()

    const syncInput = {
      broker,
      txns,
      unsupported,
      accountId: brokerMapping.accountId,
      ownerId: creds.login,
      toolVersion: TOOL_VERSION,
      couch,
      lookup,
    }

    if (dryRun) {
      const prepared = await prepareSync(syncInput)
      return NextResponse.json({
        inserted: 0,
        conflict: 0,
        preview: { new: prepared.toInsert, alreadyPresent: prepared.alreadyPresent },
        needsAsset: prepared.needsAsset,
        unsupported: prepared.unsupported,
      })
    }

    // Full sync
    const startedAt = Date.now()
    const prepared = await prepareSync(syncInput)
    const result = await commitSync(prepared, couch)
    const finishedAt = Date.now()

    // Persist sync run to SQLite
    const [runRow] = await db.insert(syncRun).values({
      startedAt,
      finishedAt,
      broker,
      accountId: brokerMapping.accountId,
      sourceFilename: filename,
      sourceSha256: sha256,
      parsedCount: result.total,
      insertedCount: result.inserted,
      conflictCount: result.conflict,
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
        ...result.preview.alreadyPresent.map(id => ({
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
