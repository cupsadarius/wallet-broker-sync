import type { MirrorRecord } from '@/src/dashboards/mirror'
import { monthEnd, shiftMonth } from '@/src/dashboards/compute/budgets'
import { maskDeep } from '@/src/mcp/mask'
import { AVERAGE_MONTHS, addDays, categoryAverages, categoryTotals, type SpendContext } from './cards'

export const TIME_ZONE = 'Europe/Bucharest'
const DUE_HOUR = 8
const RETRY_MS = 60 * 60_000
const CHANGE_MIN = 150
const CHANGE_RATIO = 0.3
const MAX_ROWS = 8

/** Day (YYYY-MM-DD), ISO weekday (Monday = 1) and hour in Bucharest. */
export function localParts(now: Date): { day: string; weekday: number; hour: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]))
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1,
    hour: Number(p.hour),
  }
}

export type WeeklyState = { doneWeek: string | null; lastAttempt: string | null }

/** The Monday key of the week whose note is due now, or null. A missed Monday catches up later that week. */
export function weeklyDue(now: Date, state: WeeklyState): string | null {
  const { day, weekday, hour } = localParts(now)
  const week = addDays(day, 1 - weekday)
  if (weekday === 1 && hour < DUE_HOUR) return null
  if (state.doneWeek === week) return null
  if (state.lastAttempt && now.getTime() - Date.parse(state.lastAttempt) < RETRY_MS) return null
  return week
}

export type BudgetFigure = { name: string; limit: number; spent: number | null; lastMonthSpent: number | null; lastMonthLimit: number }

export type Figures = {
  currency: string
  averageMonths: number
  lastWeek: { from: string; to: string; total: number; categories: { name: string; spent: number; usualWeek: number }[] }
  lastMonth: { month: string; total: number; average: number; categories: { name: string; spent: number; average: number }[] }
  budgets: { name: string; limit: number; spentThisMonth: number | null; spentLastMonth: number | null; limitLastMonth: number }[]
  changes: { name: string; lastMonth: number; average: number; change: number; changePct: number }[]
}

const whole = (n: number | null) => (n === null ? null : Math.round(n))
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Every number the weekly note may use, in whole units of `currency`. */
export function buildFigures(input: {
  records: MirrorRecord[]; ctx: SpendContext; today: string; currency: string; budgets: BudgetFigure[]
}): Figures {
  const { records, ctx, today } = input
  const monday = addDays(today, 1 - localDayOfWeek(today))
  const from = addDays(monday, -7)
  const to = addDays(monday, -1)
  const month = shiftMonth(today.slice(0, 7), -1)
  const average = categoryAverages(records, ctx, today.slice(0, 7))
  const week = categoryTotals(records, ctx, from, to)
  const last = new Map(categoryTotals(records, ctx, `${month}-01`, monthEnd(month)).map(t => [t.key, t]))
  const names = new Map([...categoryTotals(records, ctx, `${shiftMonth(month, 1 - AVERAGE_MONTHS)}-01`, monthEnd(month)), ...last.values()].map(t => [t.key, t.name]))
  const monthRows = [...names].map(([key, name]) => ({ name, spent: Math.round(last.get(key)?.spent ?? 0), average: Math.round(average.get(key) ?? 0) }))
    .sort((a, b) => b.spent - a.spent || b.average - a.average)

  return {
    currency: input.currency,
    averageMonths: AVERAGE_MONTHS,
    lastWeek: {
      from, to, total: Math.round(sum(week.map(t => t.spent))),
      categories: week.slice(0, MAX_ROWS).map(t => ({ name: t.name, spent: Math.round(t.spent), usualWeek: Math.round((average.get(t.key) ?? 0) * 12 / 52) })),
    },
    lastMonth: {
      month, total: Math.round(sum([...last.values()].map(t => t.spent))), average: Math.round(sum([...average.values()])),
      categories: monthRows.slice(0, MAX_ROWS),
    },
    budgets: input.budgets.map(b => ({
      name: b.name, limit: Math.round(b.limit), spentThisMonth: whole(b.spent), spentLastMonth: whole(b.lastMonthSpent), limitLastMonth: Math.round(b.lastMonthLimit),
    })),
    changes: monthRows
      .filter(r => Math.abs(r.spent - r.average) >= CHANGE_MIN && Math.abs(r.spent - r.average) >= CHANGE_RATIO * r.average)
      .sort((a, b) => Math.abs(b.spent - b.average) - Math.abs(a.spent - a.average)).slice(0, 5)
      .map(r => ({
        name: r.name, lastMonth: r.spent, average: r.average, change: r.spent - r.average,
        changePct: r.average ? Math.round(((r.spent - r.average) / r.average) * 100) : 100,
      })),
  }
}

function localDayOfWeek(day: string): number {
  return new Date(day + 'T12:00:00Z').getUTCDay() || 7
}

// The number check: digit groups with thousand separators first, then digits with optional decimals.
const THOUSANDS = String.raw`\d{1,3}(?:[ ,  ]\d{3})+(?!\d)`
const TOKEN = new RegExp(String.raw`${THOUSANDS}|\d+(?:[.,]\d+)?`, 'g')
const GROUPED = new RegExp(`^${THOUSANDS}$`)
const NUMBER_WORD = new RegExp(String.raw`\b(?:${(
  'two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen '
  + 'nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand dozen double twice'
).split(' ').join('|')})\b`, 'gi')

function parse(token: string): { value: number; places: number } {
  if (GROUPED.test(token)) return { value: Number(token.replace(/[ ,  ]/g, '')), places: 0 }
  const t = token.replace(',', '.')
  return { value: Number(t), places: t.includes('.') ? t.length - t.indexOf('.') - 1 : 0 }
}

const key = (value: number, places: number) => `${places}:${value.toFixed(places)}`

/**
 * Numbers in `text` that are no figure, as written, then number words. A number may drop decimals
 * of its figure (rounded half away from zero), never add any; 0 and 1 always pass.
 */
export function badNumbers(text: string, figures: Figures): string[] {
  const known = new Set<string>()
  for (const t of JSON.stringify(figures).match(TOKEN) ?? []) {
    const { value, places } = parse(t)
    for (let d = 0; d <= places; d++) known.add(key(Math.round(value * 10 ** d) / 10 ** d, d))
  }
  const bad = (text.match(TOKEN) ?? []).filter(t => {
    const { value, places } = parse(t)
    return value !== 0 && value !== 1 && !known.has(key(value, places))
  })
  return [...bad, ...(text.match(NUMBER_WORD) ?? [])]
}

export function buildNotePrompt(figures: Figures, problem?: string): string {
  return [
    'Write the user\'s weekly money note for their personal finance app. English, plain text, no Markdown, at most 130 words.',
    '- One or two sentences on last week\'s spending against a usual week.',
    '- One or two sentences on last month against the 6-month average, and on the budgets.',
    '- Then 2 or 3 concrete ways to spend less, each tied to a category in the figures, as lines that start with "- ".',
    `Amounts are in ${figures.currency}. Write every number as digits, exactly as in FIGURES; you may leave out decimals.`,
    'Write no other number: no dates, no sums or percentages of your own, no number words.',
    ...(problem ? ['', problem] : []),
    '',
    `FIGURES: ${JSON.stringify(maskDeep(figures))}`,
  ].join('\n')
}

export type Note = { text: string; status: 'ok' | 'flagged'; problem: string | null }

/** Asks for the note; one retry names the numbers that failed the check, after that the note is flagged. */
export async function composeNote(figures: Figures, ask: (prompt: string) => Promise<string>): Promise<Note> {
  let text = (await ask(buildNotePrompt(figures))).trim()
  let bad = badNumbers(text, figures)
  if (bad.length) {
    text = (await ask(buildNotePrompt(figures,
      `Your last note had numbers that are not in FIGURES: ${bad.join(', ')}. Write the note again with only FIGURES numbers.`))).trim()
    bad = badNumbers(text, figures)
  }
  return bad.length
    ? { text, status: 'flagged', problem: `Numbers not in the figures: ${bad.join(', ')}` }
    : { text, status: 'ok', problem: null }
}
