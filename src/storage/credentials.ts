import keytar from 'keytar'
const SERVICE = 'wallet-broker-sync', ACCOUNT = 'couch-basic-auth'
export type CouchCreds = { login: string; token: string }
export async function saveCouchCreds(c: CouchCreds): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(c))
}
export async function loadCouchCreds(): Promise<CouchCreds | null> {
  const v = await keytar.getPassword(SERVICE, ACCOUNT)
  return v ? JSON.parse(v) : null
}
export async function deleteCouchCreds(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT)
}
