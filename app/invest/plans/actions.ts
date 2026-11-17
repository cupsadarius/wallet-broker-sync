'use server'

import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/src/storage/db'
import { brokerAccountMap, plan } from '@/src/storage/schema'
import { readMirror } from '@/src/dashboards/mirror'
import { SUGGESTED_PLANS } from '@/src/dashboards/compute/plans'

const optional = <T extends z.ZodType>(s: T) => z.union([z.literal('').transform(() => null), s])

const common = {
  id: optional(z.coerce.number().int().positive()).default(null),
  name: z.string().trim().min(1).max(80),
  accountId: z.string().min(1).max(200),
  startDate: z.iso.date(),
  targetSymbol: optional(z.string().trim().toUpperCase().max(20)).default(null),
}
const PlanForm = z.discriminatedUnion('type', [
  z.object({
    ...common,
    type: z.literal('recurring'),
    amount: z.coerce.number().positive().max(1e9),
    frequency: z.enum(['weekly', 'monthly']),
    wholeShares: z.literal('on').optional(),
  }),
  z.object({
    ...common,
    type: z.literal('rollover'),
    maturityId: z.coerce.number().int().positive(),
    targetProduct: z.string().trim().min(1).max(80),
  }),
])

async function accountCurrency(accountId: string): Promise<string> {
  const ccy = (await readMirror())?.byAccountId.get(accountId)?.currencyCode
  if (!ccy) throw new Error('Unknown Wallet account')
  return ccy
}

export async function savePlan(form: FormData) {
  const { id, ...f } = PlanForm.parse(Object.fromEntries(form))
  const row = f.type === 'recurring'
    ? {
        type: f.type, name: f.name, accountId: f.accountId, startDate: f.startDate, targetSymbol: f.targetSymbol,
        amount: Math.round(f.amount * 100), currency: await accountCurrency(f.accountId), frequency: f.frequency,
        wholeShares: f.wholeShares === 'on', maturityId: null, targetProduct: null,
      }
    : {
        type: f.type, name: f.name, accountId: f.accountId, startDate: f.startDate, targetSymbol: f.targetSymbol,
        amount: null, currency: null, frequency: null, wholeShares: false, maturityId: f.maturityId, targetProduct: f.targetProduct,
      }
  if (id === null) await db.insert(plan).values(row)
  else await db.update(plan).set(row).where(eq(plan.id, id))
  redirect('/invest?tab=plans')
}

export async function setPlanStatus(form: FormData) {
  const { id, status } = z.object({
    id: z.coerce.number().int().positive(),
    status: z.enum(['active', 'paused', 'archived']),
  }).parse(Object.fromEntries(form))
  await db.update(plan).set({ status }).where(eq(plan.id, id))
  redirect('/invest?tab=plans')
}

export async function addSuggestedPlan(form: FormData) {
  const key = form.get('key')
  const s = SUGGESTED_PLANS.find(p => p.key === key)
  if (!s) throw new Error('Unknown suggestion')
  const mapped = (await db.select().from(brokerAccountMap).where(eq(brokerAccountMap.broker, s.broker)))[0]
  if (!mapped) throw new Error(`No Wallet account is mapped to ${s.broker}`)
  await db.insert(plan).values({
    type: 'recurring', name: s.name, accountId: mapped.accountId, amount: s.amount * 100,
    currency: await accountCurrency(mapped.accountId), frequency: s.frequency, startDate: s.startDate,
    targetSymbol: s.targetSymbol, wholeShares: s.wholeShares, status: s.status,
  })
  redirect('/invest?tab=plans')
}
