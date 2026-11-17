import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/src/storage/db'
import { budgetProposal, ruleProposal, weeklyNote } from '@/src/storage/schema'
import { ensureFreshMirror, getBaseCurrency, readConfigMap } from '@/src/dashboards/mirror'
import { aggregateSpending } from '@/src/dashboards/compute/spending'
import { latestFx } from '@/src/dashboards/prices'
import { matchingRecords } from './proposals'
import { likelyTransfers, reviewQueue, unexplainedOutflows, type ReviewState } from './review'
import { loadInsights } from '@/src/insights/load'
import { categorySpikes } from '@/src/insights/cards'

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

export async function loadSpending() {
  const s = await ensureFreshMirror(PAGE_MAX_AGE_MS)
  if (!s) return null
  const now = new Date()
  const base = await getBaseCurrency()
  const today = now.toISOString().slice(0, 10)

  const month = await aggregateSpending(s.records, base, {
    accountIds: new Set(s.accounts.filter(a => a.accountType !== 7).map(a => a.id)),
    fromDate: today.slice(0, 8) + '01',
  })
  const topCategories = month.byCategory.filter(c => c.expense > 0)
    .sort((a, b) => b.expense - a.expense).slice(0, 5)

  const outflows = await Promise.all(unexplainedOutflows(s.accounts, s.records, now).map(async o => {
    let total = 0
    for (const r of o.records) total += (r.amount / 100) * ((await latestFx(r.currencyCode || base, base, r.recordDate)) ?? 0)
    return { ...o, total }
  }))

  const proposals = (await db.select().from(ruleProposal).where(eq(ruleProposal.status, 'open'))).map(p => {
    const matches = matchingRecords(s.records, p.keywords)
    return { ...p, pastMatchCount: matches.length, toChange: matches.filter(r => r.categoryId !== p.categoryId) }
  })

  const insights = await loadInsights(s, 6, now)
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
    monthExpense: month.totals.expense,
    topCategories, outflows, proposals,
  }
}
