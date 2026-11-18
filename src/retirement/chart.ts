import type { AccountView } from './compute'

/** A month as "YYYY-MM"; every point stands for the state at the end of that month. */
type Month = string
type State = { value: number; paidIn: number }
export type TimelinePoint = { month: Month; value: number | null; projected: number | null; paidIn: number } // base ×100
export type RetirementTimeline = {
  points: TimelinePoint[]
  final: { month: Month; value: number; paidIn: number } | null                // base ×100
  atRelease: Map<string, { date: string; value: number; paidIn: number }>       // account currency ×100
}

const DAY_MS = 86_400_000
const monthOf = (date: string): Month => date.slice(0, 7)
const nextMonth = (m: Month): Month => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}
const months = (from: Month, to: Month): Month[] => {
  const out: Month[] = []
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m)
  return out
}
const endOf = (m: Month) => new Date(Date.parse(`${nextMonth(m)}-01T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
const years = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / (365.25 * DAY_MS)
const contributions = (a: AccountView) => a.contributionsByYear.flatMap(y => y.items)

/** A value at `toIso` in the money of `fromIso`, with `inflation` a year; a past or same date leaves it as is. */
export function inTodaysMoney(value: number, fromIso: string, toIso: string, inflation = 0.03): number {
  return value / (1 + inflation) ** Math.max(0, years(fromIso, toIso))
}

/** Money paid in during the 12 months before the last statement, as a yearly amount. */
export function defaultYearlyContribution(a: AccountView): number {
  const yearAgo = new Date(Date.parse(a.asOf) - 365 * DAY_MS).toISOString().slice(0, 10)
  const own = contributions(a)
  if (own.length) return own.filter(c => c.date > yearAgo && c.date <= a.asOf).reduce((n, c) => n + c.gross, 0)
  const [last, ...older] = a.statements
  const earlier = older.find(s => s.asOf <= new Date(Date.parse(yearAgo) + 45 * DAY_MS).toISOString().slice(0, 10))
  if (!last || !earlier) return 0
  return Math.round((last.paidIn - earlier.paidIn) * 365 * DAY_MS / (Date.parse(last.asOf) - Date.parse(earlier.asOf)))
}

/**
 * Value and paid-in per month, in the account currency: history up to the last statement, then a projection
 * that grows at `rate` and adds `contribution` a year, spread over the months, up to `until`.
 * With its own contributions, the history grows each one at the account's own yearly return, so it ends on the statement.
 */
export function accountTimeline(a: AccountView, opts: { rate: number; contribution: number; until: string | null }): Map<Month, State> {
  const out = new Map<Month, State>()
  const own = contributions(a).sort((x, y) => x.date.localeCompare(y.date))
  const last = monthOf(a.asOf)
  if (own.length) {
    const r = a.yearly?.rate ?? 0
    for (const m of months(monthOf(own[0].date), last)) {
      const paid = own.filter(c => monthOf(c.date) <= m)
      out.set(m, {
        value: Math.round(paid.reduce((n, c) => n + c.gross * (1 + r) ** Math.max(0, years(c.date, endOf(m))), 0)),
        paidIn: paid.reduce((n, c) => n + c.gross, 0),
      })
    }
  } else {
    const stmts = [...a.statements].reverse()
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i], next = stmts[i + 1]
      out.set(monthOf(s.asOf), { value: s.value, paidIn: s.paidIn })
      if (!next) break
      for (const m of months(nextMonth(monthOf(s.asOf)), monthOf(next.asOf)).slice(0, -1)) {
        const f = years(s.asOf, endOf(m)) / years(s.asOf, next.asOf)
        out.set(m, { value: Math.round(s.value + (next.value - s.value) * f), paidIn: Math.round(s.paidIn + (next.paidIn - s.paidIn) * f) })
      }
    }
  }
  out.set(last, { value: a.value, paidIn: a.paidIn })

  if (opts.until) for (const [m, state] of projectFrom(out.get(last)!, a.asOf, opts.until, opts)) out.set(m, state)
  return out
}

/** Month by month after `asOf` up to `until`: grows at `rate` a year and adds `contribution` a year, spread over the months. */
export function projectFrom(start: State, asOf: string, until: string, opts: { rate: number; contribution: number }): Map<Month, State> {
  const out = new Map<Month, State>()
  const growth = (1 + opts.rate) ** (1 / 12)
  let { value, paidIn } = start
  for (const m of months(nextMonth(monthOf(asOf)), monthOf(until))) {
    value = value * growth + opts.contribution / 12
    paidIn += opts.contribution / 12
    out.set(m, { value, paidIn })
  }
  return out
}

/**
 * All accounts with an exchange rate, added in the base currency. An account counts from its first month and
 * stays flat after its unlock date; one without an unlock date runs to the latest unlock date of the others.
 */
export function retirementTimeline(
  accounts: AccountView[], opts: { rate: number; contributions: Map<string, number>; today: string; horizon?: string | null },
): RetirementTimeline {
  const horizon = opts.horizon !== undefined ? opts.horizon : accounts.map(a => a.releaseDate).filter((d): d is string => !!d).sort().at(-1) ?? null
  const today = monthOf(opts.today)
  const lines = accounts.filter(a => a.valueBase !== null && a.value !== 0).map(a => {
    const until = a.locked ? (a.releaseDate ?? horizon) : null
    const contribution = opts.contributions.get(a.id) ?? defaultYearlyContribution(a)
    return { a, until, fx: a.valueBase! / a.value, line: accountTimeline(a, { rate: opts.rate, contribution, until }) }
  })
  const atRelease = new Map<string, { date: string; value: number; paidIn: number }>()
  for (const { a, until, line } of lines) {
    const end = until && line.get(monthOf(until))
    if (end && monthOf(until) > monthOf(a.asOf)) atRelease.set(a.id, { date: until, value: Math.round(end.value), paidIn: Math.round(end.paidIn) })
  }
  const all = lines.flatMap(l => [...l.line.keys()]).sort()
  if (!all.length) return { points: [], final: null, atRelease }

  const points: TimelinePoint[] = months(all[0], all.at(-1)!).map(m => {
    let value = 0, paidIn = 0
    for (const { line, fx } of lines) {
      const keys = [...line.keys()]
      const at = line.get(m) ?? (m > keys.at(-1)! ? line.get(keys.at(-1)!) : undefined)
      if (at) { value += at.value * fx; paidIn += at.paidIn * fx }
    }
    const v = Math.round(value)
    return { month: m, value: m <= today ? v : null, projected: m >= today ? v : null, paidIn: Math.round(paidIn) }
  })
  const lastPoint = points.at(-1)!
  return { points, final: { month: lastPoint.month, value: lastPoint.value ?? lastPoint.projected!, paidIn: lastPoint.paidIn }, atRelease }
}
