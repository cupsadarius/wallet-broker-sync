'use server'

import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/src/storage/db'
import { maturity } from '@/src/storage/schema'

const optional = <T extends z.ZodType>(s: T) => z.union([z.literal('').transform(() => null), s])

const MaturityForm = z.object({
  kind: z.enum(['deposit', 'bond']),
  name: z.string().trim().min(1).max(80),
  accountId: optional(z.string().max(200)),
  symbol: optional(z.string().trim().toUpperCase().max(20)),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  principal: z.coerce.number().positive().max(1e12),
  rate: optional(z.coerce.number().min(0).max(100)),
  startDate: optional(z.iso.date()),
  maturityDate: z.iso.date(),
})

export async function addMaturity(form: FormData) {
  const f = MaturityForm.parse(Object.fromEntries(form))
  await db.insert(maturity).values({
    kind: f.kind,
    name: f.name,
    accountId: f.accountId,
    symbol: f.symbol,
    currency: f.currency,
    principal: Math.round(f.principal * 100),
    rateBps: f.rate === null ? null : Math.round(f.rate * 100),
    startDate: f.startDate,
    maturityDate: f.maturityDate,
  })
  redirect('/invest/maturities')
}

export async function deleteMaturity(form: FormData) {
  const id = z.coerce.number().int().positive().parse(form.get('id'))
  await db.delete(maturity).where(eq(maturity.id, id))
  redirect('/invest/maturities')
}
