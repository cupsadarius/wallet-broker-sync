import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, runMigrations } from '@/src/storage/db'
import { config, brokerAccountMap, assetAlias, recordFallback, manualLink } from '@/src/storage/schema'
import { formatError } from '@/src/sync/format-error'

runMigrations()

const BackupSchema = z.object({
  version: z.number().int().min(1),
  exportedAt: z.string().optional(),
  connection: z.object({
    couchUrl: z.string().nullable().optional(),
    dbName: z.string().nullable().optional(),
  }).optional(),
  mappings: z.array(z.object({
    broker: z.string(),
    accountId: z.string(),
    currencyCode: z.string(),
  })).default([]),
  aliases: z.array(z.object({
    broker: z.string(),
    fromSymbol: z.string(),
    fromExchange: z.string(),
    toSymbol: z.string(),
    toExchange: z.string(),
  })).default([]),
  recordFallbacks: z.array(z.object({
    broker: z.string(),
    exchange: z.string(),
    symbol: z.string(),
  })).default([]),
  manualLinks: z.array(z.object({
    broker: z.string(),
    externalId: z.string(),
    existingDocId: z.string(),
  })).default([]),
})

/**
 * POST /api/rules-import
 * Body: BackupSchema JSON.
 * Behavior: merges rows into each table via onConflictDoNothing, so existing
 * entries on the destination machine are preserved. Connection details
 * (couchUrl/dbName) are upserted into config so the user only needs to
 * re-paste the token after import. Credentials are NEVER part of a backup.
 */
export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'expected JSON body' }, { status: 400 })
    }

    const parsed = BackupSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const path = issue?.path?.join('.') ?? 'root'
      return NextResponse.json(
        { ok: false, error: `invalid backup at ${path}: ${issue?.message ?? 'unknown'}` },
        { status: 400 },
      )
    }

    const data = parsed.data
    const counts = { mappings: 0, aliases: 0, recordFallbacks: 0, manualLinks: 0, connection: 0 }

    if (data.connection?.couchUrl) {
      await db.insert(config).values({ key: 'couchUrl', value: data.connection.couchUrl })
        .onConflictDoUpdate({ target: config.key, set: { value: data.connection.couchUrl } })
      counts.connection++
    }
    if (data.connection?.dbName) {
      await db.insert(config).values({ key: 'dbName', value: data.connection.dbName })
        .onConflictDoUpdate({ target: config.key, set: { value: data.connection.dbName } })
      counts.connection++
    }
    if (data.mappings.length > 0) {
      await db.insert(brokerAccountMap).values(data.mappings).onConflictDoNothing()
      counts.mappings = data.mappings.length
    }
    if (data.aliases.length > 0) {
      await db.insert(assetAlias).values(data.aliases).onConflictDoNothing()
      counts.aliases = data.aliases.length
    }
    if (data.recordFallbacks.length > 0) {
      await db.insert(recordFallback).values(data.recordFallbacks).onConflictDoNothing()
      counts.recordFallbacks = data.recordFallbacks.length
    }
    if (data.manualLinks.length > 0) {
      await db.insert(manualLink).values(data.manualLinks).onConflictDoNothing()
      counts.manualLinks = data.manualLinks.length
    }

    return NextResponse.json({ ok: true, counts })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/rules-import]', f.kind, f.message, f.details)
    return NextResponse.json({ ok: false, error: f.message, kind: f.kind }, { status: 500 })
  }
}
