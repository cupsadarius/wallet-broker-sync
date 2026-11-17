import xirr from 'xirr'
import type { retirementAccount, retirementContribution, retirementStatement } from '@/src/storage/schema'
import type { Task } from '@/src/dashboards/compute/today'
import { fmtDay } from '@/src/dashboards/compute/today'
import { PROVIDER_NAME, type Provider } from './types'
const STALE_DAYS = 90
const PILON1_STALE_DAYS = 365
const DAY_MS = 86_400_000

export type SummaryInput = {
  base: string
  accounts: (typeof retirementAccount.$inferSelect)[]
  statements: (typeof retirementStatement.$inferSelect)[]
  contributions: (typeof retirementContribution.$inferSelect)[]
  fx: (currency: string) => number | null      // currency → base
  today: string
  vpr: number                                   // int×100 RON per point
}

export type AccountView = {
  id: string; kind: 'pilon2' | 'pilon3' | 'unit-linked'; provider: Provider; product: string; contract: string
  currency: string; asOf: string; stale: boolean
  value: number; paidIn: number; gain: number; fees: number | null           // ints ×100, account currency
  valueBase: number | null; paidInBase: number | null                         // ints ×100, base; null without FX
  yearly: { rate: number; basis: 'contributions' | 'statements'; since: string; months: number } | null
  gainPct: number; releaseDate: string | null; locked: boolean
}
export type Pilon1View = {
  asOf: string; stale: boolean; period: { years: number; months: number; days: number }
  points: number; pointsThisYear: number; pointsByYear: { year: number; points: number }[]
  vpr: number; pensionEstimate: number                                         // ints ×100 RON
}
export type RetirementSummary = {
  base: string; accounts: AccountView[]; pilon1: Pilon1View | null
  locked: number; available: number; paidInLocked: number; unconverted: string[]
}

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS
const months = (from: string, to: string) => {
  const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

function rate(flows: { amount: number; when: string }[]): number | null {
  try {
    const r = xirr(flows.map(f => ({ amount: f.amount, when: new Date(`${f.when}T00:00:00Z`) })))
    return Number.isFinite(r) ? r : null
  } catch {
    return null
  }
}

type Stmt = SummaryInput['statements'][number]

function yearlyReturn(stmts: Stmt[], contributions: SummaryInput['contributions']): AccountView['yearly'] {
  const last = stmts[stmts.length - 1]
  if (contributions.length > 0) {
    const since = contributions.reduce((a, c) => (c.date < a ? c.date : a), contributions[0].date)
    const r = rate([...contributions.map(c => ({ amount: -c.gross, when: c.date })), { amount: last.value!, when: last.asOf }])
    return r === null ? null : { rate: r, basis: 'contributions', since, months: months(since, last.asOf) }
  }
  if (stmts.length < 2) return null
  // The first value counts as money in on its date, and every later rise in paid-in on its statement date.
  const flows = [{ amount: -stmts[0].value!, when: stmts[0].asOf }]
  for (let i = 1; i < stmts.length; i++) {
    const added = stmts[i].paidIn! - stmts[i - 1].paidIn!
    if (added !== 0) flows.push({ amount: -added, when: stmts[i].asOf })
  }
  flows.push({ amount: last.value!, when: last.asOf })
  const r = rate(flows)
  return r === null ? null : { rate: r, basis: 'statements', since: stmts[0].asOf, months: months(stmts[0].asOf, last.asOf) }
}

export function summarize(input: SummaryInput): RetirementSummary {
  const { base, today } = input
  const byAccount = (id: string) => input.statements.filter(s => s.accountId === id).sort((a, b) => a.asOf.localeCompare(b.asOf))
  const toBase = (amount: number, currency: string) => {
    if (currency === base) return amount
    const fx = input.fx(currency)
    return fx === null ? null : Math.round(amount * fx)
  }

  const accounts: AccountView[] = []
  let pilon1: Pilon1View | null = null
  for (const a of input.accounts) {
    const stmts = byAccount(a.id)
    const last = stmts[stmts.length - 1]
    if (!last) continue
    if (a.kind === 'pilon1') {
      const d = last.details!
      pilon1 = {
        asOf: last.asOf, stale: days(last.asOf, today) > PILON1_STALE_DAYS, period: d.period, points: d.points,
        pointsThisYear: d.pointsByYear.find(y => y.year === Number(today.slice(0, 4)))?.points ?? 0,
        pointsByYear: d.pointsByYear, vpr: input.vpr, pensionEstimate: Math.round(d.points * input.vpr),
      }
      continue
    }
    const value = last.value!, paidIn = last.paidIn!
    accounts.push({
      id: a.id, kind: a.kind, provider: a.provider as Provider, product: a.product, contract: a.contract, currency: a.currency,
      asOf: last.asOf, stale: days(last.asOf, today) > STALE_DAYS,
      value, paidIn, gain: value - paidIn, fees: last.fees,
      valueBase: toBase(value, a.currency), paidInBase: toBase(paidIn, a.currency),
      yearly: yearlyReturn(stmts, input.contributions.filter(c => c.accountId === a.id)),
      gainPct: paidIn > 0 ? (value - paidIn) / paidIn : 0,
      releaseDate: a.releaseDate, locked: !(a.releaseDate && a.releaseDate <= today),
    })
  }

  const sum = (xs: AccountView[], f: (a: AccountView) => number | null) => xs.reduce((s, a) => s + (f(a) ?? 0), 0)
  const locked = accounts.filter(a => a.locked)
  return {
    base, accounts, pilon1,
    locked: sum(locked, a => a.valueBase),
    available: sum(accounts.filter(a => !a.locked), a => a.valueBase),
    paidInLocked: sum(locked, a => a.paidInBase),
    unconverted: accounts.filter(a => a.valueBase === null).map(a => a.id),
  }
}

export function retirementTasks(s: RetirementSummary): Task[] {
  const task = (id: string, provider: Provider, asOf: string, what: string): Task => ({
    id: `retirement:${id}:${asOf}`, kind: 'retirement', title: `Upload ${PROVIDER_NAME[provider]} ${what}`,
    detail: `Newest ${what} is from ${fmtDay(asOf)}.`, href: '/upload', action: 'Upload',
  })
  return [
    ...s.accounts.filter(a => a.stale).map(a => task(a.id, a.provider, a.asOf, 'statement')),
    ...(s.pilon1?.stale ? [task('cnpp', 'cnpp', s.pilon1.asOf, 'report')] : []),
  ]
}
