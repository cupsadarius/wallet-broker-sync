import { z } from 'zod'
import { desc, sql } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { brokerAccountMap, weeklyNote } from '@/src/storage/schema'
import { readMirror, getBaseCurrency, getLastMirrorSync, isMirrorStale, type MirrorRecord } from '@/src/dashboards/mirror'
import { latestFx, resolveYahooTicker } from '@/src/dashboards/prices'
import { computeHoldings } from '@/src/dashboards/compute/holdings'
import { valuateHoldings } from '@/src/dashboards/compute/valuation'
import { computePerformance } from '@/src/dashboards/compute/performance'
import { computeNetWorth } from '@/src/dashboards/compute/networth'
import { aggregateSpending } from '@/src/dashboards/compute/spending'
import { accrued, payout } from '@/src/dashboards/compute/maturities'
import { loadMaturities, loadPlans } from '@/src/dashboards/portfolio'
import { loadInsights } from '@/src/insights/load'

export type McpTool = {
  name: string
  description: string
  input: z.ZodObject
  call(raw: unknown): Promise<Record<string, unknown>>
}

function tool<S extends z.ZodObject>(t: {
  name: string; description: string; input: S; run(args: z.infer<S>): Promise<Record<string, unknown>>
}): McpTool {
  return { name: t.name, description: t.description, input: t.input, call: raw => t.run(t.input.parse(raw ?? {})) }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
const ccy = z.string().regex(/^[A-Za-z]{3}$/, 'use an ISO 4217 code').transform(s => s.toUpperCase())
const broker = z.enum(['xtb', 'ibkr', 'tradeville'])
const money = (n: number) => Math.round(n * 100) / 100
const pct = (n: number | null) => (n === null ? null : Math.round(n * 10_000) / 10_000)
const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

async function load() {
  const snap = await readMirror()
  if (!snap) throw new Error('Wallet is not connected yet')
  return { snap, base: await getBaseCurrency() }
}

async function brokerAccounts(): Promise<Map<string, string>> {
  const rows = await db.select().from(brokerAccountMap)
  return new Map(rows.map(r => [r.broker, r.accountId]))
}

/** Signed native amount: income +, expense -; Wallet stores both positive. */
const signed = (r: MirrorRecord) => (r.recordType === 1 ? -r.amount : r.amount) / 100
const kind = (r: MirrorRecord) => (r.recordType === 0 ? 'income' : r.recordType === 1 ? 'expense' : 'other')

export const TOOLS: McpTool[] = [
  tool({
    name: 'list_accounts',
    description: 'Wallet accounts with their balance in the account currency: opening balance plus every record. '
      + 'Investment accounts (type "investment") show only their cash; use holdings for positions.',
    input: z.object({ includeArchived: z.boolean().default(false) }),
    async run({ includeArchived }) {
      const { snap } = await load()
      const accounts = []
      for (const a of snap.accounts) {
        if (a.archived && !includeArchived) continue
        let balance = a.initAmount / 100
        let unconverted = 0
        let lastRecordDate: string | null = null
        for (const r of snap.records) {
          if (r.accountId !== a.id) continue
          const fx = await latestFx(r.currencyCode || a.currencyCode, a.currencyCode, r.recordDate)
          if (fx === null) { unconverted++; continue }
          balance += signed(r) * fx
          if (!lastRecordDate || r.recordDate > lastRecordDate) lastRecordDate = r.recordDate
        }
        accounts.push({
          id: a.id, name: a.name, type: a.accountType === 7 ? 'investment' : 'cash', archived: a.archived,
          balance: money(balance), currency: a.currencyCode, lastRecordDate,
          ...(unconverted ? { unconvertedRecords: unconverted } : {}),
        })
      }
      return { accounts }
    },
  }),

  tool({
    name: 'query_records',
    description: 'Wallet records (income and expenses), newest first. Filter by date range, account, category and text '
      + '(note, payee or category name). groupBy aggregates by category or month. currency converts amounts with daily '
      + 'FX rates; aggregates always convert (to the base currency by default). Amounts: income +, expense -.',
    input: z.object({
      from: day.optional(), to: day.optional(),
      accountId: z.string().optional(), categoryId: z.string().optional(),
      text: z.string().min(1).optional(),
      groupBy: z.enum(['category', 'month']).optional(),
      currency: ccy.optional(),
      limit: z.number().int().min(1).max(1000).default(100),
    }),
    async run(args) {
      const { snap, base } = await load()
      const accountName = new Map(snap.accounts.map(a => [a.id, a.name]))
      const text = args.text?.toLowerCase()
      const matched = snap.records.filter(r =>
        (!args.from || r.recordDate >= args.from) && (!args.to || r.recordDate <= args.to)
        && (!args.accountId || r.accountId === args.accountId)
        && (!args.categoryId || r.categoryId === args.categoryId)
        && (!text || [r.note, r.payee, r.categoryName].some(s => s?.toLowerCase().includes(text))),
      ).sort((a, b) => b.recordDate.localeCompare(a.recordDate))

      const target = args.currency ?? (args.groupBy ? base : undefined)
      let unconverted = 0
      const convert = async (r: MirrorRecord) => {
        if (!target) return null
        const fx = await latestFx(r.currencyCode || base, target, r.recordDate)
        if (fx === null) unconverted++
        return fx === null ? null : money(signed(r) * fx)
      }

      if (args.groupBy) {
        const groups = new Map<string, { key: string; group?: string; income: number; expense: number; count: number }>()
        for (const r of matched) {
          const value = await convert(r)
          if (value === null) continue
          const byMonth = args.groupBy === 'month'
          const key = byMonth ? r.recordDate.slice(0, 7) : (r.categoryName ?? 'Uncategorised')
          const id = byMonth ? key : `${r.categoryGroupName}|${key}`
          const g = groups.get(id) ?? { key, ...(byMonth ? {} : { group: r.categoryGroupName ?? 'Uncategorised' }), income: 0, expense: 0, count: 0 }
          if (value >= 0) g.income += value
          else g.expense -= value
          g.count++
          groups.set(id, g)
        }
        return {
          currency: target, matched: matched.length, unconverted,
          groups: [...groups.values()].map(g => ({
            key: g.key, ...(g.group ? { group: g.group } : {}), income: money(g.income), expense: money(g.expense), net: money(g.income - g.expense), count: g.count,
          })),
        }
      }

      const records = []
      for (const r of matched.slice(0, args.limit)) {
        const converted = await convert(r)
        records.push({
          id: r.id, date: r.recordDate, account: accountName.get(r.accountId) ?? r.accountId,
          category: r.categoryName ?? null, type: kind(r), amount: money(signed(r)), currency: r.currencyCode || base,
          ...(target ? { converted, convertedCurrency: target } : {}),
          note: r.note ?? null, payee: r.payee ?? null,
        })
      }
      return { matched: matched.length, returned: records.length, ...(target ? { unconverted } : {}), records }
    },
  }),

  tool({
    name: 'holdings',
    description: 'Current stock and ETF positions (average cost) priced at the latest cached close, with value, cost and '
      + 'unrealized P&L in the base currency. Filter by broker or account.',
    input: z.object({ broker: broker.optional(), accountId: z.string().optional() }),
    async run(args) {
      const { snap, base } = await load()
      const accountId = args.broker ? (await brokerAccounts()).get(args.broker) : args.accountId
      if (args.broker && !accountId) throw new Error(`no Wallet account is mapped to ${args.broker}`)
      const valued = await valuateHoldings(
        computeHoldings(snap.transactions, snap.byAssetId, accountId ? { accountIds: new Set([accountId]) } : {}),
        base,
      )
      const sum = (f: (v: (typeof valued)[number]) => number | null) => money(valued.reduce((s, v) => s + (f(v) ?? 0), 0))
      return {
        baseCurrency: base, totalValue: sum(v => v.valueBase), totalCost: sum(v => v.costBase),
        holdings: valued.map(v => ({
          symbol: v.symbol, exchange: v.exchangeCode, name: v.name ?? null, quantity: v.quantity,
          avgCost: v.avgCost, price: v.priceNative, priceDate: v.priceDate, currency: v.currency,
          valueBase: v.valueBase === null ? null : money(v.valueBase),
          costBase: v.costBase === null ? null : money(v.costBase),
          pnlBase: v.unrealizedPnlBase === null ? null : money(v.unrealizedPnlBase),
          pnlPct: v.unrealizedPnlPct === null ? null : money(v.unrealizedPnlPct),
          allocationPct: v.allocationPct === null ? null : money(v.allocationPct),
        })),
      }
    },
  }),

  tool({
    name: 'performance',
    description: 'Investment performance per broker and in total, in the base currency: money-weighted return (XIRR) and '
      + 'time-weighted return (Modified Dietz), both annualized decimals (0.12 = 12%), plus contributed, realized, '
      + 'current value and total return.',
    input: z.object({ broker: broker.optional() }),
    async run(args) {
      const { snap, base } = await load()
      const mapped = [...(await brokerAccounts())].filter(([b]) => !args.broker || b === args.broker)
      const scopes: Array<[string, Set<string> | undefined]> = mapped.map(([b, id]) => [b, new Set([id])])
      if (!args.broker) scopes.push(['all', undefined])
      const results = []
      for (const [name, accountIds] of scopes) {
        const p = await computePerformance({ baseCurrency: base, txns: snap.transactions, byAssetId: snap.byAssetId, accountIds })
        results.push({
          broker: name, mwr: pct(p.mwr), twr: pct(p.twr), contributed: money(p.totalContributedBase),
          realized: money(p.totalRealizedBase), currentValue: money(p.currentValueBase),
          totalReturn: money(p.totalReturnBase), totalReturnPct: p.totalReturnPct === null ? null : money(p.totalReturnPct),
        })
      }
      return { currency: base, results }
    },
  }),

  tool({
    name: 'net_worth',
    description: 'Net worth at each month end (and today) in the base currency: cash accounts plus priced investments.',
    input: z.object({ from: day.optional(), to: day.optional() }),
    async run(args) {
      const { snap, base } = await load()
      const nw = await computeNetWorth({
        baseCurrency: base, accounts: snap.accounts, txns: snap.transactions, records: snap.records, byAssetId: snap.byAssetId,
      })
      return {
        currency: base,
        series: nw.series
          .filter(p => (!args.from || p.date >= args.from) && (!args.to || p.date <= args.to))
          .map(p => ({ date: p.date, cash: money(p.cashBase), investments: money(p.investmentBase), total: money(p.totalBase) })),
      }
    },
  }),

  tool({
    name: 'spending_by_category',
    description: 'Income and expense per category for a period, in the base currency. Transfers and broker trade records '
      + 'are left out. Defaults to the current month.',
    input: z.object({ from: day.optional(), to: day.optional(), accountId: z.string().optional() }),
    async run(args) {
      const { snap, base } = await load()
      const from = args.from ?? today().slice(0, 8) + '01'
      const to = args.to ?? today()
      const s = await aggregateSpending(snap.records, base, {
        fromDate: from, toDate: to, accountIds: args.accountId ? new Set([args.accountId]) : undefined,
      })
      return {
        currency: base, from, to, unconverted: s.unconverted,
        totals: { income: money(s.totals.income), expense: money(s.totals.expense), net: money(s.totals.net) },
        categories: s.byCategory.map(c => ({
          name: c.name, group: c.group, income: money(c.income), expense: money(c.expense), net: money(c.net), count: c.count,
        })),
      }
    },
  }),

  tool({
    name: 'list_categories',
    description: 'Wallet categories with their id and parent group.',
    input: z.object({}),
    async run() {
      const { snap } = await load()
      return { categories: snap.categories.map(c => ({ id: c.id, name: c.name, group: c.groupName })) }
    },
  }),

  tool({
    name: 'rules_and_labels',
    description: 'Wallet record rules (keywords that set a category on new records) and labels.',
    input: z.object({}),
    async run() {
      const { snap } = await load()
      return {
        rules: snap.rules.map(r => ({
          name: r.name, keywords: r.keywords, categoryId: r.categoryId ?? null,
          category: (r.categoryId && snap.byCategoryId.get(r.categoryId)?.name) || null,
          recordType: r.recordType === 0 ? 'income' : r.recordType === 1 ? 'expense' : null,
        })),
        labels: snap.labels.map(l => ({ id: l.id, name: l.name, archived: l.archived, system: l.system })),
      }
    },
  }),

  tool({
    name: 'price_history',
    description: 'Daily closes for a symbol (a Wallet symbol such as VUAA, or a Yahoo ticker such as VUAA.DE), in its '
      + 'listing currency. Defaults to the last 90 days.',
    input: z.object({ symbol: z.string().min(1), from: day.optional(), to: day.optional() }),
    async run(args) {
      const wanted = args.symbol.toUpperCase()
      const assets = (await readMirror())?.assets.filter(a => a.symbol.toUpperCase() === wanted) ?? []
      // One Wallet symbol can be listed on several exchanges; take the first ticker with prices.
      const tickers = [...new Set([...assets.map(a => resolveYahooTicker(a.symbol, a.exchangeCode) ?? wanted), wanted])]
      const read = (ticker: string) => db.all<{ date: string; close: number; currency: string }>(sql`
        SELECT date, close, currency FROM price_history
        WHERE symbol = ${ticker} AND date BETWEEN ${args.from ?? daysAgo(90)} AND ${args.to ?? today()}
        ORDER BY date`)
      const [symbol, rows] = tickers.map(t => [t, read(t)] as const).find(([, r]) => r.length) ?? [tickers[0], []]
      return {
        symbol, currency: rows[0]?.currency ?? assets[0]?.currencyCode ?? null,
        prices: rows.map(r => ({ date: r.date, close: r.close / 10_000 })),
      }
    },
  }),

  tool({
    name: 'fx_history',
    description: 'Daily FX rates: 1 unit of base in quote. Defaults to the last 90 days.',
    input: z.object({ base: ccy, quote: ccy, from: day.optional(), to: day.optional() }),
    async run(args) {
      const query = (b: string, q: string) => db.all<{ date: string; rate: number }>(sql`
        SELECT date, rate FROM fx_history
        WHERE base = ${b} AND quote = ${q} AND date BETWEEN ${args.from ?? daysAgo(90)} AND ${args.to ?? today()}
        ORDER BY date`)
      const direct = query(args.base, args.quote)
      const rates = direct.length
        ? direct.map(r => ({ date: r.date, rate: r.rate / 1_000_000 }))
        : query(args.quote, args.base).map(r => ({ date: r.date, rate: Math.round(1e12 / r.rate) / 1e6 }))
      return { base: args.base, quote: args.quote, rates }
    },
  }),

  tool({
    name: 'list_plans',
    description: 'Investment plans with progress. Recurring plans: expected contributions to date vs deposits into the '
      + 'account, periods behind, units of the target asset held, uninvested cash, and the next action. Rollover plans: '
      + 'the linked maturity date and whether the target product was bought. Amounts are in the plan currency.',
    input: z.object({ includeArchived: z.boolean().default(false) }),
    async run({ includeArchived }) {
      const { snap } = await load()
      const views = await loadPlans(snap, await loadMaturities(), today())
      return {
        plans: views.filter(v => includeArchived || v.plan.status !== 'archived').map(({ plan, accountName, progress: g }) => ({
          ...plan, account: accountName,
          progress: {
            ...g, ring: pct(g.ring),
            ...(g.cash === undefined ? {} : { cash: money(g.cash), deposited: money(g.deposited ?? 0), expected: money(g.expected ?? 0) }),
          },
        })),
      }
    },
  }),

  tool({
    name: 'list_maturities',
    description: 'Deposits and bonds entered by hand: principal, annual rate, start and maturity dates, interest accrued '
      + 'to today, and the payout at maturity (principal plus the last period of interest; null when the rate is not set).',
    input: z.object({}),
    async run() {
      const { snap } = await load()
      const day = today()
      return {
        maturities: (await loadMaturities()).map(m => {
          const p = payout(m)
          return {
            id: m.id, kind: m.kind, name: m.name, account: m.accountId ? snap.byAccountId.get(m.accountId)?.name ?? null : null,
            symbol: m.symbol, currency: m.currency, principal: money(m.principal),
            ratePct: m.rateBps === null ? null : m.rateBps / 100, startDate: m.startDate, maturityDate: m.maturityDate,
            accrued: money(accrued(m, day)), payout: p === null ? null : money(p), matured: m.maturityDate <= day,
          }
        }),
      }
    },
  }),

  tool({
    name: 'list_budgets',
    description: 'Wallet monthly budgets for the current month: limit in force, spent (expenses minus refunds in the budget '
      + 'scope, never below 0), remaining, and state: over (past the limit), pace (on pace to pass it by month end) or ok. '
      + '`months` adds that many earlier months of spent and limit. Amounts are in the budget currency; spent is null '
      + 'when a record has no exchange rate.',
    input: z.object({ months: z.number().int().min(0).max(12).default(0) }),
    async run({ months }) {
      const { snap } = await load()
      const { budgets } = await loadInsights(snap, months)
      return {
        budgets: budgets.map(({ budget, status: b, history }) => ({
          id: budget.id, name: b.name, currency: b.currency, month: b.period, limit: b.limit, spent: b.spent,
          remaining: b.spent === null ? null : money(b.limit - b.spent), expenses: b.expenses, incomes: b.incomes,
          projected: b.projected, state: b.state, history: history(months),
        })),
      }
    },
  }),

  tool({
    name: 'weekly_notes',
    description: 'The AI-written weekly money notes, newest first. numbersChecked is false when a number in the note did '
      + 'not match the computed figures; problem then names it.',
    input: z.object({ limit: z.number().int().min(1).max(20).default(4) }),
    async run({ limit }) {
      const rows = await db.select().from(weeklyNote).orderBy(desc(weeklyNote.id)).limit(limit)
      return { notes: rows.map(n => ({ week: n.week, text: n.text, numbersChecked: n.status === 'ok', problem: n.problem })) }
    },
  }),

  tool({
    name: 'data_freshness',
    description: 'When the Wallet mirror last synced, when each broker was last imported, and the latest price and FX dates.',
    input: z.object({}),
    async run() {
      const imports = db.all<{ broker: string; at: number }>(sql`
        SELECT broker, MAX(COALESCE(finished_at, started_at)) AS at FROM sync_run GROUP BY broker ORDER BY broker`)
      const latest = (table: 'price_history' | 'fx_history') =>
        db.all<{ d: string | null }>(sql`SELECT MAX(date) AS d FROM ${sql.raw(table)}`)[0]?.d ?? null
      return {
        mirrorSyncedAt: (await getLastMirrorSync())?.toISOString() ?? null,
        mirrorStale: await isMirrorStale(),
        lastImport: imports.map(i => ({ broker: i.broker, at: new Date(i.at).toISOString() })),
        latestPriceDate: latest('price_history'),
        latestFxDate: latest('fx_history'),
      }
    },
  }),
]
