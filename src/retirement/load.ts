import { db } from '@/src/storage/db'
import { retirementAccount, retirementContribution, retirementStatement } from '@/src/storage/schema'
import { getBaseCurrency, readConfigMap } from '@/src/dashboards/mirror'
import { latestFx } from '@/src/dashboards/prices'
import { summarize, type RetirementSummary } from './compute'
import { VPR_KEY } from './store'

const DEFAULT_VPR = 8100 // 81.00 RON per point, 2026

export async function loadRetirement(today = new Date().toISOString().slice(0, 10)): Promise<RetirementSummary> {
  const [accounts, statements, contributions, base, cfg] = await Promise.all([
    db.select().from(retirementAccount), db.select().from(retirementStatement), db.select().from(retirementContribution),
    getBaseCurrency(), readConfigMap(),
  ])
  const rates = new Map<string, number | null>()
  for (const c of new Set(accounts.map(a => a.currency))) if (c !== base) rates.set(c, await latestFx(c, base, today))
  const vpr = Number(cfg[VPR_KEY])
  return summarize({
    base, accounts, statements, contributions, today,
    fx: c => rates.get(c) ?? null,
    vpr: Number.isInteger(vpr) && vpr > 0 ? vpr : DEFAULT_VPR,
  })
}
