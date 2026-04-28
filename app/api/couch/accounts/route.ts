import { NextResponse } from 'next/server'
import { db, runMigrations } from '@/src/storage/db'
import { config } from '@/src/storage/schema'
import { loadCouchCreds } from '@/src/storage/credentials'
import { CouchClient } from '@/src/sync/couch'
import { LookupService } from '@/src/sync/lookup'
import { formatError } from '@/src/sync/format-error'

runMigrations()

export async function GET() {
  try {
    const creds = await loadCouchCreds()
    if (!creds) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    const rows = await db.select().from(config)
    const configMap = Object.fromEntries(rows.map(r => [r.key, r.value]))
    const couchUrl = configMap['couchUrl']
    const dbName = configMap['dbName']

    if (!couchUrl || !dbName) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    const couch = new CouchClient({ url: couchUrl, dbName, auth: creds })
    const lookup = new LookupService(couch)
    await lookup.refresh()

    const accounts = lookup.investmentAccounts()
    return NextResponse.json({ accounts })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/couch/accounts]', f.kind, f.message, f.details)
    const status = f.kind === 'unauthorized' ? 401 : f.kind === 'rate_limited' ? 429 : 500
    return NextResponse.json({ error: f.message, kind: f.kind }, { status })
  }
}
