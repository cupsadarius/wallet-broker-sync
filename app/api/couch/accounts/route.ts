import { NextResponse } from 'next/server'
import { db, runMigrations } from '@/src/storage/db'
import { config } from '@/src/storage/schema'
import { loadCouchCreds } from '@/src/storage/credentials'
import { CouchClient } from '@/src/sync/couch'
import { LookupService } from '@/src/sync/lookup'

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
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
