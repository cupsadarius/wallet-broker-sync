import { getBaseCurrency, type MirrorSnapshot } from '@/src/dashboards/mirror'
import { latestFx } from '@/src/dashboards/prices'
import { budgetHistory, budgetStatus, shiftMonth, type BudgetContext } from '@/src/dashboards/compute/budgets'
import type { SpendContext } from './cards'
import { localParts } from './weekly'

/** Amounts in the base currency for records from `from` on; older records read as null. */
export async function spendContext(s: MirrorSnapshot, base: string, from: string): Promise<SpendContext> {
  const amounts = new Map<string, number | null>()
  for (const r of s.records) {
    if (r.recordDate < from || (r.recordType !== 0 && r.recordType !== 1)) continue
    const fx = await latestFx(r.currencyCode || base, base, r.recordDate)
    amounts.set(r.id, fx === null ? null : (r.amount / 100) * fx)
  }
  return { byCategoryId: s.byCategoryId, amount: r => amounts.get(r.id) ?? null }
}

/** Open monthly budgets with this month's status; `history(n)` gives the n full months before. */
export async function budgetViews(s: MirrorSnapshot, base: string, today: string, spend: SpendContext) {
  const views = []
  for (const b of s.budgets.filter(x => !x.closed && x.type === 1)) {
    const currency = b.currencyCode ?? base
    const rate = currency === base ? 1 : await latestFx(base, currency, today)
    const ctx: BudgetContext = {
      today, currency, byCategoryId: s.byCategoryId,
      amount: r => { const a = spend.amount(r); return a === null || rate === null ? null : a * rate },
    }
    views.push({ budget: b, status: budgetStatus(b, s.records, ctx), history: (months: number) => budgetHistory(b, s.records, ctx, months) })
  }
  return views
}

/** Everything the insights need, with amounts back to `months` full months before this one. */
export async function loadInsights(s: MirrorSnapshot, months: number, now = new Date()) {
  const base = await getBaseCurrency()
  const today = localParts(now).day
  const spend = await spendContext(s, base, `${shiftMonth(today.slice(0, 7), -months)}-01`)
  return { base, today, spend, budgets: await budgetViews(s, base, today, spend) }
}
