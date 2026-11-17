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
import { config, couchDocCache, fxHistory, maturity, plan, retirementAccount, retirementContribution, retirementStatement, weeklyNote } from '@/src/storage/schema'
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
    { _id: '-Budget_1', reservedModelType: 'Budget', name: 'Food', amount: 10000, type: 1, envelopes: [1000], categoryIds: [], accountIds: [], labels: [], closed: false },
    { _id: '-Record_2', reservedModelType: 'Record', accountId: '-Account_1', categoryId: '-Category_food', amount: 12345, type: 1, currencyId: '-Currency_1', recordDate: '2026-11-03T18:00:00.000Z', payee: 'Mega Image' },
    { _id: '-Record_3', reservedModelType: 'Record', accountId: '-Account_1', amount: 200000, type: 1, transfer: true, currencyId: '-Currency_1', recordDate: '2026-11-04T10:00:00.000Z', note: 'Top-up Revolut' },
  ]
  await db.insert(couchDocCache).values(docs.map(d => ({ scope: SCOPE, docId: d._id, modelType: d.reservedModelType, json: JSON.stringify(d) })))
  await db.insert(maturity).values({ id: 1, kind: 'deposit', name: 'BT deposit', accountId: '-Account_1', currency: 'RON', principal: 100_000, rateBps: 500, startDate: '2026-01-01', maturityDate: '2027-01-01' })
  await db.insert(weeklyNote).values([
    { week: '2026-11-09', text: 'Older note.', status: 'ok', createdAt: '2026-11-09T07:00:00.000Z' },
    { week: '2026-11-16', text: 'Groceries 123 RON.', status: 'flagged', problem: 'Numbers not in the figures: 123', createdAt: '2026-11-16T07:00:00.000Z' },
  ])
  await db.insert(plan).values([
    { type: 'recurring', name: 'Save monthly', accountId: '-Account_1', amount: 10_000, currency: 'RON', frequency: 'monthly', startDate: '2026-11-01' },
    { type: 'rollover', name: 'Rollover to Fidelis', accountId: '-Account_1', startDate: '2026-11-01', maturityId: 1, targetProduct: 'Fidelis RON 2028' },
    { type: 'recurring', name: 'Old plan', accountId: '-Account_1', amount: 10_000, currency: 'RON', frequency: 'weekly', startDate: '2020-01-01', status: 'archived' },
  ])
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
    expect(data.accounts).toEqual([expect.objectContaining({ name: 'BT - Curent', balance: -623.45, currency: 'RON', type: 'cash' })])
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

  it('query_records totals leave out transfers between own accounts', async () => {
    const { data } = await call('query_records', { from: '2026-11-01', to: '2026-11-30', groupBy: 'month' })
    expect(data.groups).toEqual([{ key: '2026-11', income: 500, expense: 123.45, net: 376.55, count: 2 }])
    expect(data.transfersLeftOut).toBe(1)
  })

  it('list_plans returns each plan with its progress and leaves out archived plans', async () => {
    const { data } = await call('list_plans')
    expect(data.plans.map((p: { name: string }) => p.name)).toEqual(['Save monthly', 'Rollover to Fidelis'])
    expect(data.plans[0]).toMatchObject({ type: 'recurring', account: 'BT - Curent', amount: 100, currency: 'RON', progress: { deposited: 500, tag: 'on track' } })
    expect(data.plans[1]).toMatchObject({ type: 'rollover', targetProduct: 'Fidelis RON 2028', progress: { maturityDate: '2027-01-01' } })
    expect((await call('list_plans', { includeArchived: true })).data.plans).toHaveLength(3)
  })

  it('list_budgets gives each budget\'s spent and limit this month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'))
    try {
      const { data } = await call('list_budgets', { months: 1 })
      expect(data.budgets).toEqual([expect.objectContaining({
        name: 'Food', currency: 'RON', month: '2026-11', limit: 100, spent: 123.45, remaining: -23.45, state: 'over',
        history: [{ month: '2026-10', spent: 0, limit: 100 }],
      })])
    } finally {
      vi.useRealTimers()
    }
  })

  it('weekly_notes returns the newest notes first, with the number check result', async () => {
    const { data } = await call('weekly_notes', { limit: 1 })
    expect(data.notes).toEqual([{ week: '2026-11-16', text: 'Groceries 123 RON.', numbersChecked: false, problem: 'Numbers not in the figures: 123' }])
  })

  it('list_maturities returns the payout at maturity', async () => {
    const { data } = await call('list_maturities')
    expect(data.maturities).toEqual([expect.objectContaining({
      name: 'BT deposit', account: 'BT - Curent', principal: 1000, ratePct: 5, maturityDate: '2027-01-01', payout: 1050,
    })])
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

describe('retirement', () => {
  beforeAll(async () => {
    await db.insert(fxHistory).values({ base: 'EUR', quote: 'RON', date: '2026-01-01', rate: 5_000_000 })
    await db.insert(retirementAccount).values([
      { id: 'bt-pensia-noastra:ABC/1234567', kind: 'pilon2', provider: 'bt-pensia-noastra', product: 'Pensia Noastră', contract: 'ABC/1234567', currency: 'RON', releaseDate: '2050-01-01', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'signal-iduna:1000001/4', kind: 'unit-linked', provider: 'signal-iduna', product: '101 Invest', contract: '1000001/4', currency: 'EUR', releaseDate: null, createdAt: '2026-11-01T00:00:00Z' },
    ])
    await db.insert(retirementStatement).values([
      { accountId: 'bt-pensia-noastra:ABC/1234567', asOf: '2026-09-30', value: 165040, paidIn: 140000, fees: 500, fileHash: 'a', uploadedAt: '2026-11-17T00:00:00Z' },
      { accountId: 'signal-iduna:1000001/4', asOf: '2026-07-14', value: 240000, paidIn: 200014, fees: 1000, fileHash: 'b', uploadedAt: '2026-11-17T00:00:00Z' },
    ])
    await db.insert(retirementContribution).values([
      { accountId: 'bt-pensia-noastra:ABC/1234567', date: '2011-06-15', gross: 100000, fee: 500 },
      { accountId: 'bt-pensia-noastra:ABC/1234567', date: '2012-06-15', gross: 40000, fee: 0 },
    ])
  })

  it('returns every account with its value in RON and a masked contract', async () => {
    const { data } = await call('retirement')
    expect(data).toMatchObject({ currency: 'RON', locked: 13650.4, available: 0, unconverted: [] })
    const signal = data.accounts.find((a: { provider: string }) => a.provider === 'signal-iduna')
    expect(signal).toMatchObject({ contract: '****01/4', currency: 'EUR', value: 2400, valueRon: 12000, paidIn: 2000.14, locked: true, yearlyReturn: null })
    const bt = data.accounts.find((a: { provider: string }) => a.provider === 'bt-pensia-noastra')
    expect(bt).toMatchObject({ contract: '****4567', releaseDate: '2050-01-01', yearlyReturn: { basis: 'contributions', since: '2011-06-15' } })
    expect(bt.history).toBeUndefined()
    expect(JSON.stringify(data)).not.toContain('ABC/1234567')
  })

  it('adds the statements and contributions with includeHistory', async () => {
    const { data } = await call('retirement', { includeHistory: true })
    const bt = data.accounts.find((a: { provider: string }) => a.provider === 'bt-pensia-noastra')
    expect(bt.history).toEqual({
      statements: [{ asOf: '2026-09-30', value: 1650.4, paidIn: 1400, fees: 5 }],
      contributions: [{ date: '2011-06-15', gross: 1000, fee: 5 }, { date: '2012-06-15', gross: 400, fee: 0 }],
    })
  })

  it('net_worth splits today into available and locked', async () => {
    const { data } = await call('net_worth')
    expect(data.today.locked).toBe(13650.4)
    expect(data.today.total).toBeCloseTo(data.today.available + 13650.4, 2)
  })
})
