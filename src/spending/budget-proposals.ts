import { z } from 'zod'
import { replyProposals } from './proposals'

export type BudgetInput = {
  id: string
  name: string
  currency: string
  limit: number                                       // in force this month
  months: { month: string; spent: number | null }[]   // netted spend, oldest first
}
export type BudgetProposal = { budgetId: string; limit: number; reason: string }

export function buildBudgetPrompt(budgets: BudgetInput[]): string {
  return [
    'You propose monthly limits for the user\'s BudgetBakers Wallet budgets, from what they spent in the last 12 months',
    '(spent = expenses minus refunds in the budget\'s categories; null = no exchange rate). Propose a limit only when the',
    'current one is clearly off: far below what they spend every month, or far above it. Aim a little below the typical',
    'month, so the budget still helps them spend less. Ignore one-off spikes. Give a reason of one short sentence.',
    'Reply with JSON only: {"proposals":[{"budgetId":"...","limit":0,"reason":"..."}]}',
    '',
    'Budgets:',
    ...budgets.map(b => JSON.stringify({
      budgetId: b.id, name: b.name, currency: b.currency, limit: b.limit,
      spent: Object.fromEntries(b.months.map(m => [m.month, m.spent === null ? null : Math.round(m.spent)])),
    })),
  ].join('\n')
}

const Raw = z.object({
  budgetId: z.string().min(1),
  limit: z.number().positive().max(10_000_000),
  reason: z.string().trim().min(1).max(240),
})

/** Keeps the first valid proposal per known budget that changes its limit. */
export function parseBudgetProposals(text: string, budgets: BudgetInput[]): BudgetProposal[] {
  const byId = new Map(budgets.map(b => [b.id, b]))
  const out = new Map<string, BudgetProposal>()
  for (const item of replyProposals(text)) {
    const p = Raw.safeParse(item)
    if (!p.success) continue
    const b = byId.get(p.data.budgetId)
    const limit = Math.round(p.data.limit)
    if (!b || limit === Math.round(b.limit) || out.has(b.id)) continue
    out.set(b.id, { budgetId: b.id, limit, reason: p.data.reason })
  }
  return [...out.values()]
}
