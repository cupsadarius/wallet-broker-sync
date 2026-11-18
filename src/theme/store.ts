import { eq } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { config } from '@/src/storage/schema'
import { writeConfig } from '@/src/dashboards/mirror'
import { CONFIG_KEY, safePref } from './themes'

/** The saved theme preference slug; "system" when missing or unknown. */
export async function readThemePref(): Promise<string> {
  const row = db.select().from(config).where(eq(config.key, CONFIG_KEY)).get()
  return safePref(row?.value ?? 'system')
}

export async function saveThemePref(pref: string): Promise<void> {
  await writeConfig(CONFIG_KEY, safePref(pref))
}
