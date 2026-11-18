'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { saveThemePref } from '@/src/theme/store'

export async function saveTheme(pref: string) {
  await saveThemePref(z.string().max(64).parse(pref))
  refresh()
}
