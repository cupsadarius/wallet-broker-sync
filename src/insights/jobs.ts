import { createClient } from '@/src/ask/opencode'
import { complete } from '@/src/ask/run'
import { db } from '@/src/storage/db'
import { budgetProposal, weeklyNote } from '@/src/storage/schema'
import { readConfigMap, readMirror, writeConfig } from '@/src/dashboards/mirror'
import { sendPush } from '@/src/push/push'
import { buildBudgetPrompt, parseBudgetProposals } from '@/src/spending/budget-proposals'
import { loadInsights } from './load'
import { buildFigures, composeNote, weeklyDue, type Note } from './weekly'

const DONE_KEY = 'weekly.doneWeek'
const ATTEMPT_KEY = 'weekly.lastAttempt'
const NOTE_MONTHS = 7
const PROPOSAL_MONTHS = 12

const ask = (prompt: string) => complete(createClient(), prompt)

async function mirror() {
  const s = await readMirror()
  if (!s) throw new Error('Wallet is not connected')
  return s
}

/** Builds the figures, asks for the note, stores it, and pushes it when it passed the number check. */
export async function writeWeeklyNote(week: string, now = new Date()): Promise<Note> {
  const s = await mirror()
  const { base, today, spend, budgets } = await loadInsights(s, NOTE_MONTHS, now)
  const figures = buildFigures({
    records: s.records, ctx: spend, today, currency: base,
    budgets: budgets.map(v => {
      const [last] = v.history(1)
      return { name: v.budget.name, limit: v.status.limit, spent: v.status.spent, lastMonthSpent: last.spent, lastMonthLimit: last.limit }
    }),
  })
  const note = await composeNote(figures, ask)
  await db.insert(weeklyNote).values({ week, ...note, createdAt: now.toISOString() })
  if (note.status === 'ok') {
    await sendPush({ title: 'Your weekly money note is ready', body: note.text.split('\n')[0].slice(0, 140), url: '/spending#note' })
  }
  return note
}

/** Called from the mirror loop: writes this week's note once, from Monday 08:00 Bucharest time. */
export async function maybeWriteWeeklyNote(now = new Date()): Promise<void> {
  const cfg = await readConfigMap()
  const week = weeklyDue(now, { doneWeek: cfg[DONE_KEY] ?? null, lastAttempt: cfg[ATTEMPT_KEY] ?? null })
  if (!week) return
  await writeConfig(ATTEMPT_KEY, now.toISOString())
  await writeWeeklyNote(week, now)
  await writeConfig(DONE_KEY, week)
}

/** Asks for budget limits from the last 12 months and stores new proposals; returns how many the AI made. */
export async function proposeBudgets(now = new Date()): Promise<number> {
  const s = await mirror()
  const { budgets } = await loadInsights(s, PROPOSAL_MONTHS, now)
  const inputs = budgets.map(v => ({
    id: v.budget.id, name: v.budget.name, currency: v.status.currency, limit: v.status.limit,
    months: v.history(PROPOSAL_MONTHS).map(h => ({ month: h.month, spent: h.spent })),
  }))
  if (inputs.length === 0) return 0
  const proposals = parseBudgetProposals(await ask(buildBudgetPrompt(inputs)), inputs)
  for (const b of inputs) {
    for (const p of proposals.filter(x => x.budgetId === b.id)) {
      await db.insert(budgetProposal).values({
        id: `${b.id}|${p.limit}`, budgetId: b.id, currentLimit: Math.round(b.limit * 100), limit: p.limit * 100,
        reason: p.reason, createdAt: now.toISOString(),
      }).onConflictDoNothing()
    }
  }
  return proposals.length
}
