const SERVICE = 'wallet-broker-sync', ACCOUNT = 'couch-basic-auth'
export type CouchCreds = { login: string; token: string }
export type CouchConnection = { url: string; dbName: string; login: string; token: string }

const ENV = { url: 'WALLET_COUCH_URL', dbName: 'WALLET_COUCH_DB', login: 'WALLET_COUCH_LOGIN', token: 'WALLET_COUCH_TOKEN' } as const

/** All four WALLET_COUCH_* vars → connection; none → null; some → throws naming the missing vars. */
export function envCouchConnection(env: Record<string, string | undefined> = process.env): CouchConnection | null {
  const entries = Object.entries(ENV).map(([field, name]) => [field, name, env[name]?.trim()] as const)
  const missing = entries.filter(([, , v]) => !v).map(([, name]) => name)
  if (missing.length === entries.length) return null
  if (missing.length) throw new Error(`WALLET_COUCH_* incomplete: missing ${missing.join(', ')}`)
  return Object.fromEntries(entries.map(([field, , v]) => [field, v])) as CouchConnection
}

export function isConnectionManagedByEnv(): boolean {
  return envCouchConnection() !== null
}

// keytar is optional and absent in the container: neither the bundler nor tsc may resolve it.
type Keytar = {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}
const KEYTAR = 'keytar'
async function keychain(): Promise<Keytar | null> {
  try {
    return (await import(/* turbopackIgnore: true */ KEYTAR)).default
  } catch {
    return null
  }
}
const NO_KEYCHAIN = 'Keychain unavailable: set the WALLET_COUCH_* env vars'

export async function saveCouchCreds(c: CouchCreds) {
  const k = await keychain()
  if (!k) throw new Error(NO_KEYCHAIN)
  await k.setPassword(SERVICE, ACCOUNT, JSON.stringify(c))
}

export async function loadCouchCreds(): Promise<CouchCreds | null> {
  const env = envCouchConnection()
  if (env) return { login: env.login, token: env.token }
  const v = await (await keychain())?.getPassword(SERVICE, ACCOUNT)
  return v ? JSON.parse(v) : null
}

export async function deleteCouchCreds() { await (await keychain())?.deletePassword(SERVICE, ACCOUNT) }

/** Upserts config couchUrl/dbName from env. No-op without env. */
export async function applyEnvConnection(): Promise<void> {
  const env = envCouchConnection()
  if (!env) return
  const { db } = await import('./db')
  const { config } = await import('./schema')
  for (const [key, value] of [['couchUrl', env.url], ['dbName', env.dbName]] as const) {
    await db.insert(config).values({ key, value }).onConflictDoUpdate({ target: config.key, set: { value } })
  }
}
