import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/src/storage/db'
import { budgetProposal, ruleProposal, weeklyNote } from '@/src/storage/schema'
import { ensureFreshMirror, getBaseCurrency, readConfigMap } from '@/src/dashboards/mirror'
import { latestFx } from '@/src/dashboards/prices'
import { isUncategorized, matchingRecords } from './proposals'
import { likelyTransfers, reviewQueue, unexplainedOutflows, type ReviewState } from './review'
import { loadInsights } from '@/src/insights/load'
import { categorySpikes } from '@/src/insights/cards'
import { aggregateSpending, budgetsByCategory, categoryDetails, isTransfer } from '@/src/dashboards/compute/spending'
import { shiftMonth } from '@/src/dashboards/compute/budgets'

export const REVIEW_CURSOR_KEY = 'spending.reviewCursor'
export const REVIEW_ACCEPTED_KEY = 'spending.reviewAccepted'
export const TRANSFERS_DISMISSED_KEY = 'spending.transfersDismissed'

export async function readDismissedTransfers(): Promise<string[]> {
  const cfg = await readConfigMap()
  try { return z.array(z.string()).parse(JSON.parse(cfg[TRANSFERS_DISMISSED_KEY] ?? '[]')) } catch { return [] }
}
const FIRST_REVIEW_DAYS = 14
const PAGE_MAX_AGE_MS = 5 * 60_000
const NOTES_SHOWN = 5

export async function readReviewState(now = new Date()): Promise<ReviewState> {
  const cfg = await readConfigMap()
  let accepted: string[] = []
  try { accepted = z.array(z.string()).parse(JSON.parse(cfg[REVIEW_ACCEPTED_KEY] ?? '[]')) } catch { /* reset */ }
  return {
    cursor: cfg[REVIEW_CURSOR_KEY] ?? new Date(now.getTime() - FIRST_REVIEW_DAYS * 86_400_000).toISOString(),
    accepted,
  }
}

/** Spending over the last `months` months, the current one included. */
export async function loadSpending(months = 12) {
  const s = await ensureFreshMirror(PAGE_MAX_AGE_MS)
  if (!s) return null
  const now = new Date()
  const base = await getBaseCurrency()
  const today = now.toISOString().slice(0, 10)
  const monthList = Array.from({ length: months }, (_, i) => shiftMonth(today.slice(0, 7), i - months + 1))
  const period = await aggregateSpending(s.records, base, {
    accountIds: new Set(s.accounts.filter(a => a.accountType !== 7).map(a => a.id)),
    accountNameById: new Map(s.accounts.map(a => [a.id, a.name])),
    fromDate: `${monthList[0]}-01`,
  })
  const outflows = await Promise.all(unexplainedOutflows(s.accounts, s.records, now).map(async o => {
    let total = 0
    for (const r of o.records) total += (r.amount / 100) * ((await latestFx(r.currencyCode || base, base, r.recordDate)) ?? 0)
    return { ...o, total }
  }))

  const proposals = (await db.select().from(ruleProposal).where(eq(ruleProposal.status, 'open'))).map(p => {
    const matches = matchingRecords(s.records, p.keywords)
    return { ...p, matches }
  })

  const insights = await loadInsights(s, 6, now)
  const uncategorized = new Set(s.records
    .filter(r => r.recordDate >= `${monthList[0]}-01` && !r.isTradeFallback && !isTransfer(r) && isUncategorized(r, s.byCategoryId))
    .map(r => r.id))
  const budgets = insights.budgets.map(v => v.status)
  const byBudget = new Map(budgets.map(b => [b.id, b]))
  const budgetProposals = (await db.select().from(budgetProposal).where(eq(budgetProposal.status, 'open')))
    .flatMap(p => { const b = byBudget.get(p.budgetId); return b ? [{ ...p, budget: b }] : [] })

  return {
    snapshot: s, base, today,
    budgets, budgetProposals,
    spikes: categorySpikes(s.records, insights.spend, insights.today),
    notes: await db.select().from(weeklyNote).orderBy(desc(weeklyNote.id)).limit(NOTES_SHOWN),
    queue: reviewQueue(s.records, await readReviewState(now)),
    transfers: likelyTransfers(s.records, today, new Set(await readDismissedTransfers())),
    outflows, proposals,
    period, months: monthList,
    categories: categoryDetails(period, monthList, s.rules, proposals),
    budgetsByCategory: budgetsByCategory(budgets, period.byCategory),
    budgetHistory: new Map(insights.budgets.map(v => [v.status.id, v.history(months)])),
    uncategorized,
    sortable: new Set(proposals.flatMap(p => p.matches.filter(r => uncategorized.has(r.id)).map(r => r.id))).size,
  }
}
