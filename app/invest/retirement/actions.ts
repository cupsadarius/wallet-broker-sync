'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { setAssumedReturn, setReleaseDate, setVpr, setYearlyContribution } from '@/src/retirement/store'

const ReleaseForm = z.object({
  accountId: z.string().min(1).max(200),
  date: z.union([z.literal('').transform(() => null), z.iso.date()]),
})

export async function saveReleaseDate(form: FormData) {
  const f = ReleaseForm.parse(Object.fromEntries(form))
  await setReleaseDate(f.accountId, f.date)
  refresh()
}

export async function saveVpr(form: FormData) {
  const { vpr } = z.object({ vpr: z.coerce.number().positive().max(10_000) }).parse(Object.fromEntries(form))
  await setVpr(Math.round(vpr * 100))
  refresh()
}

const ContributionForm = z.object({
  accountId: z.string().min(1).max(200),
  amount: z.union([z.literal('').transform(() => null), z.coerce.number().min(0).max(10_000_000)]),
})

/** An empty amount goes back to the last 12 months of payments. */
export async function saveContribution(form: FormData) {
  const f = ContributionForm.parse(Object.fromEntries(form))
  await setYearlyContribution(f.accountId, f.amount === null ? null : Math.round(f.amount * 100))
  refresh()
}

export async function saveReturn(form: FormData) {
  const { rate } = z.object({ rate: z.coerce.number().min(-10).max(30) }).parse(Object.fromEntries(form))
  await setAssumedReturn(rate)
  refresh()
}
