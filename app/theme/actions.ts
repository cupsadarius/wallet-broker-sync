'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { saveThemePref } from '@/src/theme/store'

/** Takes FormData: the access proxy refuses text/plain writes, which a plain-argument action call sends. */
export async function saveTheme(form: FormData) {
  await saveThemePref(z.string().max(64).parse(form.get('pref')))
  refresh()
}
