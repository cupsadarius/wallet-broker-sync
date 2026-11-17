import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db, runMigrations: () => {} }
})
vi.mock('@/src/storage/credentials', () => ({ loadCouchCreds: async () => ({ login: 'u', token: 't' }) }))

import { db } from '@/src/storage/db'
import { config, couchDocCache } from '@/src/storage/schema'
import { scopeFor } from '@/src/sync/couch-cache'
import { handleMcp } from '@/src/mcp/http'

const TOKEN = 'secret-token'
const SCOPE = scopeFor('https://couch.example', 'bb-1')

async function post(body: unknown, auth: string | null = `Bearer ${TOKEN}`, token: string | undefined = TOKEN) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  return handleMcp(new Request('http://wallet-sync:8090/mcp', { method: 'POST', headers, body: JSON.stringify(body) }), token)
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  const { result } = await res.json()
  const isError = result.isError === true
  return { isError, data: isError ? result.content[0].text : JSON.parse(result.content[0].text) }
}

beforeAll(async () => {
  await db.insert(config).values([
    { key: 'couchUrl', value: 'https://couch.example' },
    { key: 'dbName', value: 'bb-1' },
    { key: 'dashboard.baseCurrency', value: 'RON' },
  ])
  const docs = [
    { _id: '-Currency_1', reservedModelType: 'Currency', code: 'RON' },
    { _id: '-Account_1', reservedModelType: 'Account', name: 'BT - Curent', accountType: 0, currencyId: '-Currency_1', initAmount: 100000 },
    { _id: '-Category_food', reservedModelType: 'Category', name: 'Groceries', envelopeId: 1000 },
    { _id: '-Record_1', reservedModelType: 'Record', accountId: '-Account_1', amount: 50000, type: 0, currencyId: '-Currency_1', recordDate: '2026-11-01T09:00:00.000Z', note: 'Salary from RO49AAAA1B31007593840000' },
    { _id: '-Record_2', reservedModelType: 'Record', accountId: '-Account_1', categoryId: '-Category_food', amount: 12345, type: 1, currencyId: '-Currency_1', recordDate: '2026-11-03T18:00:00.000Z', payee: 'Mega Image' },
  ]
  await db.insert(couchDocCache).values(docs.map(d => ({ scope: SCOPE, docId: d._id, modelType: d.reservedModelType, json: JSON.stringify(d) })))
})

describe('auth', () => {
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }
  it('returns 404 when WALLET_MCP_TOKEN is unset', async () => {
    expect((await post(init, `Bearer ${TOKEN}`, '')).status).toBe(404)
  })
  it('rejects a missing or wrong token with 401', async () => {
    expect((await post(init, null)).status).toBe(401)
    expect((await post(init, 'Bearer nope')).status).toBe(401)
  })
  it('answers initialize with the right token', async () => {
    const res = await post(init)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'wallet-sync' } })
  })
  it('accepts a notification with 202 and no body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
  })
})

describe('tools/list', () => {
  it('lists every tool with a name, a description and an object input schema', async () => {
    const { result } = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    const names = result.tools.map((t: { name: string }) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(expect.arrayContaining(['list_accounts', 'query_records', 'holdings', 'performance', 'data_freshness']))
    for (const t of result.tools) {
      expect(t.description).toBeTruthy()
      expect(t.inputSchema.type).toBe('object')
    }
  })
})

describe('tools/call', () => {
  it('list_accounts returns the balance with its currency and the as-of time', async () => {
    const { data } = await call('list_accounts')
    expect(data).toHaveProperty('asOf')
    expect(data.accounts).toEqual([expect.objectContaining({ name: 'BT - Curent', balance: 1376.55, currency: 'RON', type: 'cash' })])
  })

  it('query_records filters by text and masks the IBAN in the note', async () => {
    const { data } = await call('query_records', { text: 'salary' })
    expect(data.records).toEqual([expect.objectContaining({ date: '2026-11-01', amount: 500, currency: 'RON', type: 'income', note: 'Salary from ****0000' })])
  })

  it('query_records aggregates by category in the base currency', async () => {
    const { data } = await call('query_records', { from: '2026-11-01', to: '2026-11-30', groupBy: 'category' })
    expect(data.currency).toBe('RON')
    expect(data.groups).toEqual(expect.arrayContaining([{ key: 'Groceries', group: 'Food & Drinks', income: 0, expense: 123.45, net: -123.45, count: 1 }]))
  })

  it('returns a tool error for invalid arguments', async () => {
    const { isError, data } = await call('query_records', { from: '1 Nov' })
    expect(isError).toBe(true)
    expect(data).toContain('YYYY-MM-DD')
  })

  it('returns a JSON-RPC error for an unknown tool', async () => {
    const res = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } })
    expect((await res.json()).error.code).toBe(-32602)
  })
})
