import { db } from '@/src/storage/db'
import { retirementAccount, retirementContribution, retirementStatement } from '@/src/storage/schema'
import { getBaseCurrency, readConfigMap } from '@/src/dashboards/mirror'
import { latestFx } from '@/src/dashboards/prices'
import { summarize, type RetirementSummary } from './compute'
import { defaultYearlyContribution, retirementTimeline, type RetirementTimeline, type TimelinePoint } from './chart'
import { RETURN_KEY, VPR_KEY } from './store'

const DEFAULT_VPR = 8100 // 81.00 RON per point, 2026
const DEFAULT_RETURN = 5   // percent a year

export type Retirement = RetirementSummary & {
  projection: {
    rate: number                                                   // fraction a year
    timeline: RetirementTimeline
    byAccount: Map<string, TimelinePoint[]>
    contributions: Map<string, { yearly: number; isDefault: boolean }>  // ×100, account currency
  }
}

export async function loadRetirement(today = new Date().toISOString().slice(0, 10)): Promise<Retirement> {
  const [accounts, statements, contributions, base, cfg] = await Promise.all([
    db.select().from(retirementAccount), db.select().from(retirementStatement), db.select().from(retirementContribution),
    getBaseCurrency(), readConfigMap(),
  ])
  const rates = new Map<string, number | null>()
  for (const c of new Set(accounts.map(a => a.currency))) if (c !== base) rates.set(c, await latestFx(c, base, today))
  const vpr = Number(cfg[VPR_KEY])
  const s = summarize({
    base, accounts, statements, contributions, today,
    fx: c => rates.get(c) ?? null,
    vpr: Number.isInteger(vpr) && vpr > 0 ? vpr : DEFAULT_VPR,
  })
  const percent = Number(cfg[RETURN_KEY] ?? DEFAULT_RETURN)
  const rate = (Number.isFinite(percent) ? percent : DEFAULT_RETURN) / 100
  const own = new Map(accounts.map(a => [a.id, a.yearlyContribution]))
  const yearly = new Map(s.accounts.map(a => {
    const set = own.get(a.id)
    return [a.id, set == null ? { yearly: defaultYearlyContribution(a), isDefault: true } : { yearly: set, isDefault: false }]
  }))
  const opts = { rate, contributions: new Map([...yearly].map(([id, c]) => [id, c.yearly])), today }
  const horizon = s.accounts.map(a => a.releaseDate).filter((d): d is string => !!d).sort().at(-1) ?? null
  return {
    ...s,
    projection: {
      rate, contributions: yearly,
      timeline: retirementTimeline(s.accounts, opts),
      byAccount: new Map(s.accounts.map(a => [a.id, retirementTimeline([a], { ...opts, horizon }).points])),
    },
  }
}
