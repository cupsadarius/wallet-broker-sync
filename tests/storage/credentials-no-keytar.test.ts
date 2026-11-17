import { it, expect, vi } from 'vitest'
vi.mock('keytar', () => { throw new Error("Cannot find package 'keytar'") })
import { loadCouchCreds } from '@/src/storage/credentials'

it('loadCouchCreds returns null when keytar is not installed and env is unset', async () => {
  for (const k of ['WALLET_COUCH_URL', 'WALLET_COUCH_DB', 'WALLET_COUCH_LOGIN', 'WALLET_COUCH_TOKEN']) delete process.env[k]
  expect(await loadCouchCreds()).toBeNull()
})
