// Read-only: counts Couch docs per reservedModelType. Writes nothing.
import { CouchClient } from '@/src/sync/couch'
import { loadCouchCreds } from '@/src/storage/credentials'
import { db } from '@/src/storage/db'
import { config } from '@/src/storage/schema'

async function main() {
  const cfg = Object.fromEntries((await db.select().from(config)).map(r => [r.key, r.value]))
  const creds = await loadCouchCreds()
  if (!cfg.couchUrl || !cfg.dbName || !creds) throw new Error('no Couch connection configured')
  const client = new CouchClient({ url: cfg.couchUrl, dbName: cfg.dbName, auth: creds })
  const counts = new Map<string, number>()
  for await (const c of client.changesSince(0)) {
    if (c.deleted || !c.doc) continue
    const t = String(c.doc['reservedModelType'] ?? '(none)')
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${t}`)
}

main().catch(e => { console.error(e); process.exit(1) })
