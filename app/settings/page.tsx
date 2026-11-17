import { loadCouchCreds, isConnectionManagedByEnv } from '@/src/storage/credentials'
import { db } from '@/src/storage/db'
import { config, brokerAccountMap, assetAlias, recordFallback, manualLink } from '@/src/storage/schema'
import { getBaseCurrency, getMirrorIntervalMs } from '@/src/dashboards/mirror'
import SettingsView from './SettingsView'

export default async function SettingsPage() {
  // Connection
  const creds = await loadCouchCreds()
  const cfgRows = await db.select().from(config)
  const cfgMap = Object.fromEntries(cfgRows.map(r => [r.key, r.value]))

  // Mask the login: show first 4 and last 4, stars in between
  function maskLogin(login: string): string {
    if (login.length <= 8) return '****'
    return login.slice(0, 4) + '****' + login.slice(-4)
  }

  const connectionInfo = {
    couchUrl: cfgMap['couchUrl'] ?? null,
    dbName: cfgMap['dbName'] ?? null,
    loginMasked: creds ? maskLogin(creds.login) : null,
    hasCreds: creds !== null,
    managedByEnv: isConnectionManagedByEnv(),
  }

  // All rule tables
  const mappings = await db.select().from(brokerAccountMap)
  const aliases = await db.select().from(assetAlias)
  const fallbacks = await db.select().from(recordFallback)
  const links = await db.select().from(manualLink)

  const [baseCurrency, mirrorIntervalMs] = await Promise.all([
    getBaseCurrency(),
    getMirrorIntervalMs(),
  ])

  return (
    <SettingsView
      connection={connectionInfo}
      mappings={mappings}
      aliases={aliases}
      fallbacks={fallbacks}
      links={links}
      dashboard={{ baseCurrency, mirrorIntervalMs }}
    />
  )
}
