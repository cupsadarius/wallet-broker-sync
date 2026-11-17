import type { BrokerId } from '@/src/types'
import type { MirrorAssetTransaction, MirrorCategory, MirrorRecord } from '@/src/dashboards/mirror'
import { isTransfer } from '@/src/dashboards/compute/spending'
import { paysInto } from '@/src/dashboards/compute/today'
import { tradeCash } from '@/src/dashboards/compute/plans'
import { monthEnd, shiftMonth } from '@/src/dashboards/compute/budgets'

export type SpendContext = {
  byCategoryId: Map<string, MirrorCategory>
  /** Record amount in the base currency, major units; null when no rate exists. */
  amount: (r: MirrorRecord) => number | null
}
export type CategoryTotal = { key: string; name: string; spent: number }

const NOT_SPEND_GROUPS = new Set(['Income', 'System', 'Investments'])
const SPIKE_RATIO = 1.5
const SPIKE_MIN = 200          // base currency
export const AVERAGE_MONTHS = 6
const IDLE_CASH_MIN = 1_000    // base currency
const IDLE_DAYS = 14
const DAY_MS = 86_400_000

const round2 = (n: number) => Math.round(n * 100) / 100
export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10)

/** Spend per category between two days: expenses minus refunds, without transfers, trades and income. */
export function categoryTotals(records: MirrorRecord[], ctx: SpendContext, from: string, to: string): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>()
  for (const r of records) {
    if (r.recordDate < from || r.recordDate > to || r.isTradeFallback || isTransfer(r)) continue
    if (r.recordType !== 0 && r.recordType !== 1) continue
    const c = r.categoryId ? ctx.byCategoryId.get(r.categoryId) : undefined
    if (c && NOT_SPEND_GROUPS.has(c.groupName)) continue
    const a = ctx.amount(r)
    if (a === null) continue
    const name = c?.name || 'Uncategorised'
    const key = `${c?.groupName || 'Uncategorised'}||${name}`.toLowerCase()
    const t = totals.get(key) ?? { key, name, spent: 0 }
    t.spent += r.recordType === 1 ? a : -a
    totals.set(key, t)
  }
  return [...totals.values()].map(t => ({ ...t, spent: round2(t.spent) })).filter(t => t.spent > 0)
    .sort((a, b) => b.spent - a.spent)
}

/** Average monthly spend per category over the 6 full months before `month`. */
export function categoryAverages(records: MirrorRecord[], ctx: SpendContext, month: string): Map<string, number> {
  const from = `${shiftMonth(month, -AVERAGE_MONTHS)}-01`
  const to = monthEnd(shiftMonth(month, -1))
  return new Map(categoryTotals(records, ctx, from, to).map(t => [t.key, round2(t.spent / AVERAGE_MONTHS)]))
}

/** Categories whose month so far already runs well above their 6-month average. */
export function categorySpikes(records: MirrorRecord[], ctx: SpendContext, today: string) {
  const month = today.slice(0, 7)
  const average = categoryAverages(records, ctx, month)
  return categoryTotals(records, ctx, `${month}-01`, today)
    .map(t => ({ ...t, average: average.get(t.key) ?? 0 }))
    .filter(t => t.spent >= t.average * SPIKE_RATIO && t.spent - t.average >= SPIKE_MIN)
    .sort((a, b) => (b.spent - b.average) - (a.spent - a.average))
}

export type BrokerAccount = { accountId: string; name: string; broker: BrokerId; currency: string }

/**
 * Cash a broker account held above 1,000 base for more than 14 days. Cash = records on the account,
 * plus bank payments into it that the account does not mirror, minus trade cash.
 */
export function idleBrokerCash(
  brokers: BrokerAccount[], records: MirrorRecord[], transactions: MirrorAssetTransaction[],
  rate: (currency: string) => number | null, today: string,
) {
  return brokers.flatMap(b => {
    const toBase = rate(b.currency)
    if (toBase === null) return []
    const own = records.filter(r => r.accountId === b.accountId && r.currencyCode === b.currency)
    const mirrored = new Set(own.map(r => r.transferId).filter(Boolean))
    const moves = [
      ...own.map(r => ({ date: r.recordDate, cash: (r.recordType === 0 ? r.amount : r.recordType === 1 ? -r.amount : 0) / 100 })),
      ...records.filter(r => r.currencyCode === b.currency && paysInto(r, b.accountId, b.broker)
        && !(r.transferId && mirrored.has(r.transferId))).map(r => ({ date: r.recordDate, cash: r.amount / 100 })),
      ...transactions.filter(t => t.accountId === b.accountId).map(t => ({ date: t.date, cash: -tradeCash(t, b.currency) })),
    ].filter(m => m.date <= today).sort((x, y) => x.date.localeCompare(y.date))

    let cash = 0
    let since: string | null = null
    for (let i = 0; i < moves.length; i++) {
      cash += moves[i].cash
      if (moves[i + 1]?.date === moves[i].date) continue
      if (cash * toBase < IDLE_CASH_MIN) since = null
      else since ??= moves[i].date
    }
    if (!since || since > addDays(today, -IDLE_DAYS)) return []
    return [{ accountId: b.accountId, name: b.name, currency: b.currency, cash: round2(cash), since }]
  })
}
