/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('keytar', () => ({ default: { setPassword: vi.fn(), getPassword: vi.fn(), deletePassword: vi.fn() } }))
import keytar from 'keytar'
import { saveCouchCreds, loadCouchCreds, envCouchConnection } from '@/src/storage/credentials'

const ENV_KEYS = ['WALLET_COUCH_URL', 'WALLET_COUCH_DB', 'WALLET_COUCH_LOGIN', 'WALLET_COUCH_TOKEN']

describe('credentials', () => {
  beforeEach(() => { vi.resetAllMocks(); for (const k of ENV_KEYS) delete process.env[k] })
  afterEach(() => { for (const k of ENV_KEYS) delete process.env[k] })

  it('saves and loads creds', async () => {
    await saveCouchCreds({ login: 'u', token: 't' })
    expect(keytar.setPassword).toHaveBeenCalledWith('wallet-broker-sync', 'couch-basic-auth', JSON.stringify({ login: 'u', token: 't' }))
    ;(keytar.getPassword as any).mockResolvedValueOnce(JSON.stringify({ login: 'u', token: 't' }))
    expect(await loadCouchCreds()).toEqual({ login: 'u', token: 't' })
  })

  it('loads creds from env without touching keytar', async () => {
    Object.assign(process.env, {
      WALLET_COUCH_URL: 'https://couch.example', WALLET_COUCH_DB: 'bb-1',
      WALLET_COUCH_LOGIN: 'envuser', WALLET_COUCH_TOKEN: 'envtoken',
    })
    expect(await loadCouchCreds()).toEqual({ login: 'envuser', token: 'envtoken' })
    expect(keytar.getPassword).not.toHaveBeenCalled()
  })

  it('throws on partial env and names the missing vars', () => {
    const env = { WALLET_COUCH_URL: 'https://couch.example', WALLET_COUCH_TOKEN: 't' }
    expect(() => envCouchConnection(env)).toThrow(/WALLET_COUCH_DB.*WALLET_COUCH_LOGIN/)
  })

  it('returns null when no env vars are set', () => {
    expect(envCouchConnection({})).toBeNull()
  })
})
