import { redirect } from 'next/navigation'
import { loadCouchCreds } from '@/src/storage/credentials'
import { db } from '@/src/storage/db'
import { config, brokerAccountMap } from '@/src/storage/schema'

export default async function Home() {
  const creds = await loadCouchCreds()
  if (!creds) redirect('/setup')

  const cfgRows = await db.select().from(config)
  const cfgMap = Object.fromEntries(cfgRows.map(r => [r.key, r.value]))
  if (!cfgMap.couchUrl || !cfgMap.dbName) redirect('/setup')

  const mappings = await db.select().from(brokerAccountMap)
  if (mappings.length < 3) redirect('/setup')

  redirect('/upload')
}
