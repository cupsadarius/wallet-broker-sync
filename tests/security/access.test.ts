import { describe, it, expect } from 'vitest'
import { checkAccess, policyFromEnv, type AccessPolicy, type AccessRequest } from '@/src/security/access'

const policy: AccessPolicy = {
  users: new Set(['darius@example.com']),
  hosts: new Set(['localhost', '127.0.0.1', '[::1]', 'mac-pro.tailnet.ts.net']),
  requireUser: true,
}
const HOST = 'mac-pro.tailnet.ts.net'
const req = (r: Partial<AccessRequest>): AccessRequest => ({
  method: 'GET', path: '/', host: HOST, login: 'darius@example.com', contentType: null, origin: null, ...r,
})

describe('checkAccess', () => {
  it('allows a known user on a known host, ignoring case and port', () => {
    expect(checkAccess(req({ host: 'Mac-Pro.Tailnet.ts.net:443', login: 'Darius@Example.com' }), policy)).toBeNull()
  })
  it('rejects an unknown host with 421', () => {
    expect(checkAccess(req({ host: 'evil.example' }), policy)).toMatchObject({ status: 421 })
  })
  it('rejects a missing login with 403', () => {
    expect(checkAccess(req({ login: null }), policy)).toMatchObject({ status: 403 })
  })
  it('lets /api/health through without a login', () => {
    expect(checkAccess(req({ path: '/api/health', login: null }), policy)).toBeNull()
  })
  it('lets /mcp through without a login, from the opencode container host', () => {
    const mcp = { ...policy, hosts: new Set([...policy.hosts, 'wallet-sync']) }
    expect(checkAccess(req({ method: 'POST', path: '/mcp', host: 'wallet-sync:8090', login: null, contentType: 'application/json' }), mcp)).toBeNull()
  })
  it('still rejects /mcp on an unknown host', () => {
    expect(checkAccess(req({ method: 'POST', path: '/mcp', host: 'wallet-sync:8090', login: null }), policy)).toMatchObject({ status: 421 })
  })
  it('still requires a login below /mcp', () => {
    expect(checkAccess(req({ path: '/mcp/x', login: null }), policy)).toMatchObject({ status: 403 })
  })
  it('allows a same-origin multipart upload', () => {
    expect(checkAccess(req({ method: 'POST', path: '/api/sync', contentType: 'multipart/form-data; boundary=x', origin: `https://${HOST}` }), policy)).toBeNull()
  })
  it('allows a same-origin write with no body', () => {
    expect(checkAccess(req({ method: 'DELETE', path: '/api/config', origin: `https://${HOST}` }), policy)).toBeNull()
  })
  it('treats an explicit default port in Host as same-origin', () => {
    expect(checkAccess(req({ method: 'POST', path: '/api/sync', host: `${HOST}:443`, contentType: 'application/json', origin: `https://${HOST}` }), policy)).toBeNull()
  })
  it('rejects a text/plain write', () => {
    expect(checkAccess(req({ method: 'POST', path: '/api/sync', contentType: 'text/plain;charset=UTF-8' }), policy)).toMatchObject({ status: 403 })
  })
  it('rejects a cross-origin JSON write', () => {
    expect(checkAccess(req({ method: 'POST', path: '/api/config', contentType: 'application/json', origin: 'https://evil.example' }), policy)).toMatchObject({ status: 403 })
  })
  it('allows an IPv6 loopback host with a port', () => {
    expect(checkAccess(req({ host: '[::1]:8090' }), policy)).toBeNull()
  })
})

describe('policyFromEnv', () => {
  it('throws in production without allowed users', () => {
    expect(() => policyFromEnv({ NODE_ENV: 'production' })).toThrow('WALLET_ALLOWED_USERS is required in production')
  })
  it('does not require a user in development without users', () => {
    expect(policyFromEnv({ NODE_ENV: 'development' }).requireUser).toBe(false)
  })
  it('rejects a host entry with a port', () => {
    expect(() => policyFromEnv({ NODE_ENV: 'development', WALLET_ALLOWED_HOSTS: 'mac-pro:8090' })).toThrow()
  })
})
