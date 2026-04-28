/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('keytar', () => ({ default: { setPassword: vi.fn(), getPassword: vi.fn(), deletePassword: vi.fn() } }))
import keytar from 'keytar'
import { saveCouchCreds, loadCouchCreds } from '@/src/storage/credentials'

describe('credentials', () => {
  beforeEach(() => { vi.resetAllMocks() })
  it('saves and loads creds', async () => {
    await saveCouchCreds({ login: 'u', token: 't' })
    expect(keytar.setPassword).toHaveBeenCalledWith('wallet-broker-sync', 'couch-basic-auth', JSON.stringify({ login: 'u', token: 't' }))
    ;(keytar.getPassword as any).mockResolvedValueOnce(JSON.stringify({ login: 'u', token: 't' }))
    expect(await loadCouchCreds()).toEqual({ login: 'u', token: 't' })
  })
})
