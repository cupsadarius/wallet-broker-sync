import type { MirrorBudget, MirrorCategory, MirrorRecord } from '../mirror'
import { isTransfer } from './spending'
import { fmtAmount, type Task } from './today'

export type BudgetContext = {
  today: string
  currency: string      // the budget's currency, resolved
  byCategoryId: Map<string, MirrorCategory>
  /** Record amount in the budget currency, major units; null when no rate exists. */
  amount: (r: MirrorRecord) => number | null
}

export type BudgetSpend = { spent: number | null; expenses: number | null; incomes: number | null; count: number }
export type BudgetStatus = BudgetSpend & {
  id: string
  name: string
  currency: string
  period: string        // YYYY-MM
  periodStart: string
  periodEnd: string
  limit: number
  projected: number | null
  state: 'over' | 'pace' | 'ok'
}

// Wallet leaves these out of a budget even when the scope matches.
const NOT_SPEND_GROUPS = new Set(['Income', 'Unknown', 'System'])

const monthOf = (date: string) => date.slice(0, 7)
export const monthEnd = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10)
export const shiftMonth = (ym: string, n: number) => {
  const i = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}
const round2 = (n: number) => Math.round(n * 100) / 100

/** The limit in force for a month: the latest change dated in or before it, else the base amount. */
export function effectiveLimit(b: MirrorBudget, ym: string): number {
  const change = b.changes.filter(c => monthOf(c.date) <= ym).sort((x, y) => x.date.localeCompare(y.date)).at(-1)
  return (change?.amount ?? b.amount) / 100
}

function inScope(b: MirrorBudget, r: MirrorRecord, byCategoryId: Map<string, MirrorCategory>): boolean {
  const c = r.categoryId ? byCategoryId.get(r.categoryId) : undefined
  if (!c || NOT_SPEND_GROUPS.has(c.groupName) || r.transfer || isTransfer(r)) return false
  if ((b.envelopes.length || b.categoryIds.length)
    && !(c.envelopeId !== undefined && b.envelopes.includes(c.envelopeId)) && !b.categoryIds.includes(c.id)) return false
  if (b.accountIds.length && !b.accountIds.includes(r.accountId)) return false
  return !b.labelIds.length || (r.labels ?? []).some(l => b.labelIds.includes(l))
}

/** Wallet's budget model: spent = max(0, expenses − incomes) over the records in scope. */
function spend(b: MirrorBudget, records: MirrorRecord[], from: string, to: string, ctx: BudgetContext): BudgetSpend {
  let expenses = 0, incomes = 0, count = 0, missing = false
  for (const r of records) {
    if (r.recordDate < from || r.recordDate > to || (r.recordType !== 0 && r.recordType !== 1)) continue
    if (!inScope(b, r, ctx.byCategoryId)) continue
    const a = ctx.amount(r)
    if (a === null) { missing = true; continue }
    if (r.recordType === 1) expenses += a
    else incomes += a
    count++
  }
  if (missing) return { spent: null, expenses: null, incomes: null, count }
  return { spent: round2(Math.max(0, expenses - incomes)), expenses: round2(expenses), incomes: round2(incomes), count }
}

export function budgetStatus(b: MirrorBudget, records: MirrorRecord[], ctx: BudgetContext): BudgetStatus {
  const period = monthOf(ctx.today)
  const periodStart = `${period}-01`
  const periodEnd = monthEnd(period)
  const s = spend(b, records, periodStart, periodEnd, ctx)
  const limit = effectiveLimit(b, period)
  const projected = s.spent === null ? null
    : round2(s.spent * Number(periodEnd.slice(8)) / Number(ctx.today.slice(8, 10)))
  const state = s.spent !== null && s.spent > limit ? 'over' : projected !== null && projected > limit ? 'pace' : 'ok'
  return { id: b.id, name: b.name, currency: ctx.currency, period, periodStart, periodEnd, limit, ...s, projected, state }
}

/** Spent and limit for each of the `months` full months before the current one, oldest first. */
export function budgetHistory(b: MirrorBudget, records: MirrorRecord[], ctx: BudgetContext, months: number) {
  return Array.from({ length: months }, (_, i) => {
    const month = shiftMonth(monthOf(ctx.today), i - months)
    return { month, spent: spend(b, records, `${month}-01`, monthEnd(month), ctx).spent, limit: effectiveLimit(b, month) }
  })
}

/** Budget `changes` that set `limit` (major units) from the month of `now` on; later changes are dropped. */
export function limitChanges(changes: { amount: number; date: string }[] | undefined, limit: number, now: string) {
  return [...(changes ?? []).filter(c => monthOf(c.date) < monthOf(now)), { amount: Math.round(limit * 100), date: now }]
}

export function budgetTasks(statuses: BudgetStatus[]): Task[] {
  return statuses.filter(s => s.state === 'over').map(s => ({
    id: `budget:${s.id}:${s.period}`,
    kind: 'budget',
    title: `${s.name} budget passed`,
    detail: `${Math.round(s.spent ?? 0).toLocaleString('en-US')} of ${fmtAmount(s.limit, s.currency)} spent this month.`,
    href: '/spending#budgets',
    action: 'Open',
  }))
}
