import type { BrokerId } from '@/src/types'
import type { MirrorAsset, MirrorAssetTransaction, MirrorRecord } from '../mirror'
import type { Maturity } from './maturities'
import { incomeKind } from './income'
import { fmtAmount, fmtDay, paysInto, type Task } from './today'

export type PlanStatus = 'active' | 'paused' | 'archived'
type PlanBase = { id: number; name: string; accountId: string; startDate: string; status: PlanStatus; targetSymbol: string | null }
export type RecurringPlan = PlanBase & {
  type: 'recurring'; amount: number; currency: string; frequency: 'weekly' | 'monthly'; wholeShares: boolean
}
export type RolloverPlan = PlanBase & { type: 'rollover'; maturityId: number | null; targetProduct: string }
export type Plan = RecurringPlan | RolloverPlan

export type PlanTag = 'on track' | 'behind' | 'paused' | 'archived' | 'done'

export type PlanProgress = {
  tag: PlanTag
  ring: number            // 0..1
  line: string            // one status line for Today
  detail: string          // plan card sub line
  holding: string | null
  action: string | null
  // recurring
  expected?: number
  deposited?: number
  periodsBehind?: number
  held?: number
  cash?: number
  // rollover
  maturityDate?: string | null
}

export type PlanContext = {
  broker: BrokerId | null
  records: MirrorRecord[]
  transactions: MirrorAssetTransaction[]   // asset transactions plus fallback trades
  byAssetId: Map<string, MirrorAsset>
  price: number | null                     // last close of the target, in the plan currency
  maturity: Maturity | null
  today: string
}

const DAY_MS = 86_400_000
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS)
const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10)
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
const fmtMonth = (date: string) =>
  new Date(date.slice(0, 7) + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const lower = (s: string) => s[0].toLowerCase() + s.slice(1)

/** Periods that ended before `today`; a contribution is due by the end of its period. */
function periodsEnded(p: RecurringPlan, today: string): { count: number; nextDue: string } {
  if (today < p.startDate) return { count: 0, nextDue: p.startDate }
  if (p.frequency === 'weekly') {
    const count = Math.floor(days(p.startDate, today) / 7)
    return { count, nextDue: addDays(p.startDate, (count + 1) * 7 - 1) }
  }
  const m = monthIndex(today)
  const lastDay = new Date(Date.UTC(Math.floor(m / 12), (m % 12) + 1, 0)).toISOString().slice(0, 10)
  return { count: m - monthIndex(p.startDate), nextDue: lastDay }
}

/** Money paid into the account since the plan start, each Wallet transfer counted once. */
function deposited(p: RecurringPlan, ctx: PlanContext): number {
  const seen = new Set<string>()
  let sum = 0
  for (const r of ctx.records) {
    if (r.recordDate < p.startDate || r.recordDate > ctx.today || r.currencyCode !== p.currency) continue
    const into = r.accountId === p.accountId
      ? r.recordType === 0 && !r.isTradeFallback && incomeKind(r) === null
      : paysInto(r, p.accountId, ctx.broker)
    const key = r.transferId ?? r.id
    if (!into || seen.has(key)) continue
    seen.add(key)
    sum += r.amount / 100
  }
  return sum
}

/** Cash a trade took from (+) or paid into (−) the account, in `currency`; 0 when in another currency. */
function tradeCash(t: MirrorAssetTransaction, currency: string): number {
  const sign = t.transactionType === 1 ? -1 : 1
  if (t.cashAmount !== undefined && t.cashAmountCurrencyCode === currency) return sign * t.cashAmount / 100
  if (t.priceCurrencyCode === currency) return sign * t.quantity * t.price / 100
  return 0
}

function targetTrades(p: Plan, ctx: PlanContext): MirrorAssetTransaction[] {
  const symbol = p.targetSymbol?.toUpperCase()
  return ctx.transactions
    .filter(t => t.accountId === p.accountId && t.date <= ctx.today && ctx.byAssetId.get(t.assetId)?.symbol.toUpperCase() === symbol)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function recurring(p: RecurringPlan, ctx: PlanContext): PlanProgress {
  const { count, nextDue } = periodsEnded(p, ctx.today)
  const expected = count * p.amount
  const paid = deposited(p, ctx)
  const shortfall = Math.max(0, Math.round((expected - paid) * 100) / 100)
  const periodsBehind = Math.floor(shortfall / p.amount + 1e-9)
  const unit = p.frequency === 'weekly' ? 'week' : 'month'

  const trades = targetTrades(p, ctx)
  const held = trades.reduce((q, t) => q + (t.transactionType === 1 ? -t.quantity : t.quantity), 0)
  const spent = ctx.transactions
    .filter(t => t.accountId === p.accountId && t.date >= p.startDate && t.date <= ctx.today)
    .reduce((s, t) => s + tradeCash(t, p.currency), 0)
  const cash = Math.max(0, paid - spent)
  const last = trades.at(-1)
  const lastPrice = last?.priceCurrencyCode === p.currency ? last.price / 100 : null
  const price = ctx.price ?? lastPrice
  const unitsFor = (money: number) => {
    if (!p.targetSymbol || !price) return null
    const u = money / price
    return p.wholeShares ? Math.floor(u + 1e-9) : Math.floor(u * 100 + 1e-9) / 100
  }
  const into = (n: number | null) => (n ? ` → ${n} ${p.targetSymbol}` : '')

  const buyNow = unitsFor(cash)
  const action = p.status !== 'active' ? null
    : shortfall > 0 ? `Deposit ${fmtAmount(shortfall, p.currency)}${into(unitsFor(cash + shortfall))}`
    : buyNow ? `Buy ${buyNow} ${p.targetSymbol}`
    : `Next ${fmtAmount(p.amount, p.currency)} by ${fmtDay(nextDue)}`
  const tag: PlanTag = p.status !== 'active' ? p.status : periodsBehind > 0 ? 'behind' : 'on track'
  const lastBuy = trades.filter(t => t.transactionType === 0).at(-1)
  const status = tag === 'behind' ? `${plural(periodsBehind, unit)} behind`
    : tag === 'on track' ? 'On track'
    : `${tag === 'paused' ? 'Paused' : 'Archived'}${lastBuy ? ` · last buy ${fmtDay(lastBuy.date)}` : ''}`

  return {
    tag,
    ring: p.status !== 'active' || expected === 0 ? 1 : Math.min(1, paid / expected),
    line: action ? `${status} · ${lower(action)}` : status,
    detail: [
      `${paid.toLocaleString('en-US', { maximumFractionDigits: 0 })} of ${fmtAmount(expected, p.currency)} since ${fmtMonth(p.startDate)}`,
      `${fmtAmount(p.amount, p.currency)}/${unit}`,
      ...(p.wholeShares && p.targetSymbol ? ['whole shares'] : []),
    ].join(' · '),
    holding: [...(p.targetSymbol ? [`${held} ${p.targetSymbol}`] : []), `${fmtAmount(cash, p.currency)} cash`].join(' · '),
    action,
    expected, deposited: paid, periodsBehind, held, cash,
  }
}

function rollover(p: RolloverPlan, ctx: PlanContext): PlanProgress {
  const m = ctx.maturity
  const base = { holding: null, maturityDate: m?.maturityDate ?? null }
  const paused = p.status !== 'active' ? p.status : null
  if (!m) {
    const line = 'Maturity deleted · edit the plan'
    return { ...base, tag: paused ?? 'behind', ring: 0, line, detail: line, action: null }
  }
  const detail = `${fmtAmount(m.principal, m.currency)} ${m.name} · matures ${fmtDay(m.maturityDate)} · buy ${p.targetProduct}`
  if (ctx.today < m.maturityDate) {
    const start = m.startDate ?? p.startDate
    const left = days(ctx.today, m.maturityDate)
    const togo = left < 60 ? plural(left, 'day') : plural(Math.round(left / 30.44), 'month')
    return {
      ...base, tag: paused ?? 'on track', detail, action: null,
      ring: Math.min(1, Math.max(0, days(start, ctx.today) / Math.max(1, days(start, m.maturityDate)))),
      line: `${togo} to go · ${fmtDay(m.maturityDate)}`,
    }
  }
  const bought = targetTrades(p, ctx).find(t => t.transactionType === 0 && t.date >= m.maturityDate)
  if (bought) {
    return { ...base, tag: paused ?? 'done', ring: 1, detail, action: null, line: `Done · bought ${p.targetProduct} on ${fmtDay(bought.date)}` }
  }
  const action = paused ? null : `Buy ${p.targetProduct}`
  return { ...base, tag: paused ?? 'behind', ring: 1, detail, action, line: `Matured ${fmtDay(m.maturityDate)} · buy ${p.targetProduct}` }
}

export function planProgress(p: Plan, ctx: PlanContext): PlanProgress {
  return p.type === 'recurring' ? recurring(p, ctx) : rollover(p, ctx)
}

/** "Plan behind" tasks; the id changes once per missed period so a new shortfall shows anew. */
export function planTasks(items: { plan: Plan; progress: PlanProgress }[]): Task[] {
  return items
    .filter(({ plan, progress }) => plan.status === 'active' && progress.tag === 'behind')
    .map(({ plan, progress: g }) => ({
      id: `plan:${plan.id}:${g.expected ?? g.maturityDate}`,
      kind: 'plan',
      title: plan.type === 'recurring'
        ? `${plan.name} is ${plural(g.periodsBehind ?? 0, plan.frequency === 'weekly' ? 'week' : 'month')} behind`
        : `${plan.name} needs you`,
      detail: `${g.action ?? g.line}.`,
      href: '/invest?tab=plans',
      action: 'Open',
    }))
}
