import { NextResponse } from 'next/server'
import { db, runMigrations } from '@/src/storage/db'
import { config, brokerAccountMap, assetAlias, recordFallback, manualLink } from '@/src/storage/schema'
import { inArray } from 'drizzle-orm'

runMigrations()

export const EXPORT_VERSION = 1

export async function GET() {
  const [mappings, aliases, fallbacks, links, connRows] = await Promise.all([
    db.select().from(brokerAccountMap),
    db.select().from(assetAlias),
    db.select().from(recordFallback),
    db.select().from(manualLink),
    db.select().from(config).where(inArray(config.key, ['couchUrl', 'dbName'])),
  ])
  const connection = Object.fromEntries(connRows.map(r => [r.key, r.value]))

  const payload = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    connection: {
      couchUrl: connection['couchUrl'] ?? null,
      dbName: connection['dbName'] ?? null,
    },
    mappings,
    aliases,
    recordFallbacks: fallbacks,
    manualLinks: links,
  }

  const body = JSON.stringify(payload, null, 2)
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="wallet-broker-sync-rules-${date}.json"`,
    },
  })
}
