import { sql } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { brokerAccountMap, maturity, plan as planTable } from '@/src/storage/schema'
import type { BrokerId } from '@/src/types'
import {
  ensureFreshMirror, getBaseCurrency, getLastMirrorSync, withFallbackTrades, type MirrorSnapshot,
} from './mirror'
import { latestClose, latestFx, resolveYahooTicker } from './prices'
import { computeHoldings } from './compute/holdings'
import { valuateHoldings } from './compute/valuation'
import { computePerformance, type CashFlow } from './compute/performance'
import { buildPositions } from './compute/positions'
import { comingUp, type Maturity } from './compute/maturities'
import { incomeKind, type IncomeKind } from './compute/income'
import {
  accountBalances, bankTasks, dataAge, maturityTasks, uploadTasks, type Task,
} from './compute/today'
import { planProgress, planTasks, type Plan, type PlanProgress } from './compute/plans'
import { budgetTasks } from './compute/budgets'
import { loadInsights } from '@/src/insights/load'
import { idleBrokerCash } from '@/src/insights/cards'

const PAGE_MAX_AGE_MS = 5 * 60_000
const DAY_MS = 86_400_000

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export async function loadMaturities(): Promise<Maturity[]> {
  const rows = await db.select().from(maturity)
  return rows.map(r => ({ ...r, principal: r.principal / 100 }))
}

async function lastImports(): Promise<Partial<Record<BrokerId, string>>> {
  const rows = db.all<{ broker: BrokerId; t: number }>(
    sql`SELECT broker, MAX(COALESCE(finished_at, started_at)) AS t FROM sync_run GROUP BY broker`,
  )
  return Object.fromEntries(rows.map(r => [r.broker, new Date(r.t).toISOString()]))
}

function need<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`plan row without ${what}`)
  return v
}

function toPlan(r: typeof planTable.$inferSelect): Plan {
  const base = { id: r.id, name: r.name, accountId: r.accountId, startDate: r.startDate, status: r.status, targetSymbol: r.targetSymbol }
  return r.type === 'recurring'
    ? { ...base, type: 'recurring', amount: need(r.amount, 'amount') / 100, currency: need(r.currency, 'currency'), frequency: need(r.frequency, 'frequency'), wholeShares: r.wholeShares }
    : { ...base, type: 'rollover', maturityId: r.maturityId, targetProduct: need(r.targetProduct, 'target product') }
}

export type PlanView = { plan: Plan; accountName: string; progress: PlanProgress }

/** Every plan with its progress; archived plans come last. */
export async function loadPlans(s: MirrorSnapshot, maturities: Maturity[], today = isoDay(new Date())): Promise<PlanView[]> {
  const plans = (await db.select().from(planTable)).map(toPlan)
  const brokerOf = new Map((await db.select().from(brokerAccountMap)).map(r => [r.accountId, r.broker as BrokerId]))
  const { transactions, byAssetId } = withFallbackTrades(s)
  const views: PlanView[] = []
  for (const p of plans) {
    let price: number | null = null
    if (p.type === 'recurring' && p.targetSymbol) {
      const symbol = p.targetSymbol.toUpperCase()
      const held = transactions.find(t => t.accountId === p.accountId && byAssetId.get(t.assetId)?.symbol.toUpperCase() === symbol)
      const asset = held ? byAssetId.get(held.assetId) : s.assets.find(a => a.symbol.toUpperCase() === symbol)
      const close = asset ? await latestClose(resolveYahooTicker(asset.symbol, asset.exchangeCode) ?? symbol, today) : null
      const fx = close ? await latestFx(close.currency, p.currency, today) : null
      if (close && fx !== null) price = close.close * fx
    }
    views.push({
      plan: p,
      accountName: s.byAccountId.get(p.accountId)?.name ?? 'Unknown account',
      progress: planProgress(p, {
        broker: brokerOf.get(p.accountId) ?? null, records: s.records, transactions, byAssetId, price, today,
        maturity: p.type === 'rollover' ? maturities.find(m => m.id === p.maturityId) ?? null : null,
      }),
    })
  }
  return views.sort((a, b) => Number(a.plan.status === 'archived') - Number(b.plan.status === 'archived') || a.plan.id - b.plan.id)
}

export async function loadTasks(s: MirrorSnapshot, maturities: Maturity[], today = isoDay(new Date())): Promise<Task[]> {
  const brokers = (await db.select().from(brokerAccountMap))
    .map(r => ({ broker: r.broker as BrokerId, accountId: r.accountId }))
  return [
    ...uploadTasks({ brokers, records: s.records, transactions: s.transactions, lastImport: await lastImports() }),
    ...planTasks(await loadPlans(s, maturities, today)),
    ...maturityTasks(maturities, today),
    ...bankTasks(s.accounts, s.records),
    ...budgetTasks((await loadInsights(s, 0)).budgets.map(v => v.status)),
  ]
}

async function portfolioAt(s: MirrorSnapshot, base: string, asOf: string, maturities: Maturity[]) {
  const { transactions, byAssetId } = withFallbackTrades(s)
  const upto = transactions.filter(t => t.date <= asOf)
  const byBroker = await Promise.all(s.accounts.filter(a => a.accountType === 7).map(async a => ({
    broker: a.name,
    holdings: await valuateHoldings(computeHoldings(upto, byAssetId, { accountIds: new Set([a.id]) }), base, asOf),
  })))
  const rates = new Map<string, number | null>()
  for (const m of maturities) rates.set(m.currency, await latestFx(m.currency, base, asOf))
  return buildPositions(byBroker, maturities, asOf, rates)
}

async function cashAt(s: MirrorSnapshot, base: string, asOf: string) {
  const cashAccounts = s.accounts.filter(a => a.accountType !== 7)
  const balances = accountBalances(cashAccounts, s.records, asOf)
  const accounts = await Promise.all(cashAccounts.map(async a => ({
    name: a.name,
    base: (balances.get(a.id) ?? 0) * ((await latestFx(a.currencyCode, base, asOf)) ?? 0),
  })))
  accounts.sort((a, b) => b.base - a.base)
  return { totalBase: accounts.reduce((sum, a) => sum + a.base, 0), accounts }
}

export async function loadToday() {
  const s = await ensureFreshMirror(PAGE_MAX_AGE_MS)
  if (!s) return null
  const now = new Date()
  const today = isoDay(now)
  const monthAgo = isoDay(new Date(now.getTime() - 30 * DAY_MS))
  const [base, maturities, lastSync] = await Promise.all([getBaseCurrency(), loadMaturities(), getLastMirrorSync()])

  const [inv, invThen, cash, cashThen] = await Promise.all([
    portfolioAt(s, base, today, maturities),
    portfolioAt(s, base, monthAgo, maturities),
    cashAt(s, base, today),
    cashAt(s, base, monthAgo),
  ])
  const netWorth = inv.investedBase + cash.totalBase
  const netWorthThen = invThen.investedBase + cashThen.totalBase
  const pricesAsOf = db.all<{ d: string | null }>(sql`SELECT MAX(date) AS d FROM price_history`)[0]?.d ?? null

  return {
    base,
    netWorth,
    change30dPct: netWorthThen > 0 ? ((netWorth - netWorthThen) / netWorthThen) * 100 : null,
    invested: { value: inv.investedBase, gain: inv.investedBase - inv.costBase, cost: inv.costBase },
    cash: { total: cash.totalBase, top: cash.accounts[0] ?? null },
    tasks: await loadTasks(s, maturities, today),
    plans: (await loadPlans(s, maturities, today)).filter(v => v.plan.status === 'active'),
    events: comingUp(maturities, today),
    age: dataAge({
      accounts: s.accounts, records: s.records, lastImport: await lastImports(),
      pricesAsOf, mirrorAsOf: lastSync?.toISOString() ?? null, now,
    }),
  }
}

export async function loadPositions() {
  const s = await ensureFreshMirror(PAGE_MAX_AGE_MS)
  if (!s) return null
  const [base, maturities] = await Promise.all([getBaseCurrency(), loadMaturities()])
  return { base, ...(await portfolioAt(s, base, isoDay(new Date()), maturities)) }
}

export async function loadPerformance() {
  const s = await ensureFreshMirror(PAGE_MAX_AGE_MS)
  if (!s) return null
  const base = await getBaseCurrency()
  const { transactions, byAssetId } = withFallbackTrades(s)
  const brokers = s.accounts.filter(a => a.accountType === 7)
  const brokerIds = new Set(brokers.map(a => a.id))

  const income: { date: string; kind: IncomeKind; accountId: string; base: number }[] = []
  for (const r of s.records) {
    const kind = incomeKind(r)
    if (!kind) continue
    const fx = await latestFx(r.currencyCode || base, base, r.recordDate)
    if (fx !== null) income.push({ date: r.recordDate, kind, accountId: r.accountId, base: (r.amount / 100) * fx })
  }
  const flowsOf = (ids: Set<string>): CashFlow[] =>
    income.filter(i => ids.has(i.accountId)).map(i => ({ date: i.date, amountBase: i.base }))

  const perf = (ids: Set<string>) =>
    computePerformance({ baseCurrency: base, txns: transactions, byAssetId, accountIds: ids, extraFlows: flowsOf(ids) })
  const [total, ...perBroker] = await Promise.all([perf(brokerIds), ...brokers.map(a => perf(new Set([a.id])))])

  // Money put in = net trade cash (buys minus sells) up to each sample.
  const series = total.series.map(p => ({
    ...p,
    putInBase: -total.cashFlows.filter(f => f.date <= p.date).reduce((sum, f) => sum + f.amountBase, 0),
  }))
  const yearAgo = isoDay(new Date(Date.now() - 365 * DAY_MS))
  const incomeTotals = (['dividend', 'coupon', 'interest'] as const).map(kind => ({
    kind,
    lastYear: income.filter(i => i.kind === kind && i.date >= yearAgo).reduce((sum, i) => sum + i.base, 0),
    allTime: income.filter(i => i.kind === kind).reduce((sum, i) => sum + i.base, 0),
  }))

  return {
    base,
    total,
    series,
    brokers: brokers.map((a, i) => ({ name: a.name, perf: perBroker[i] })),
    incomeTotals,
  }
}

/** Invest insight cards: broker cash that sits idle, and plans behind their deposits. */
export async function loadInvestCards() {
  const s = await ensureFreshMirror(PAGE_MAX_AGE_MS)
  if (!s) return null
  const today = isoDay(new Date())
  const base = await getBaseCurrency()
  const brokers = (await db.select().from(brokerAccountMap)).flatMap(m => {
    const a = s.byAccountId.get(m.accountId)
    return a ? [{ accountId: a.id, name: a.name, broker: m.broker as BrokerId, currency: a.currencyCode }] : []
  })
  const rates = new Map<string, number | null>()
  for (const b of brokers) rates.set(b.currency, await latestFx(b.currency, base, today))
  return {
    idle: idleBrokerCash(brokers, s.records, s.transactions, c => rates.get(c) ?? null, today),
    gaps: planTasks(await loadPlans(s, await loadMaturities(), today)),
  }
}
