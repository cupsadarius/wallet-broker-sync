import { loadCouchCreds } from '@/src/storage/credentials'
import { db } from '@/src/storage/db'
import { config, brokerAccountMap } from '@/src/storage/schema'
import SetupForm from './SetupForm'
import AccountMappingForm from './AccountMappingForm'

export default async function SetupPage() {
  const creds = await loadCouchCreds()
  if (!creds) return <SetupForm />

  const cfgRows = await db.select().from(config)
  const cfgMap = Object.fromEntries(cfgRows.map(r => [r.key, r.value]))
  if (!cfgMap.couchUrl || !cfgMap.dbName) return <SetupForm />

  const mappings = await db.select().from(brokerAccountMap)
  return <AccountMappingForm existingMappings={mappings} />
}
