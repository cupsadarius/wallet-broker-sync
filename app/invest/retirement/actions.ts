'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { setReleaseDate, setVpr } from '@/src/retirement/store'

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
