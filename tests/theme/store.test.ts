import { describe, it, expect, vi } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db, runMigrations: () => {} }
})

import { writeConfig } from '@/src/dashboards/mirror'
import { readThemePref, saveThemePref } from '@/src/theme/store'
import { CONFIG_KEY } from '@/src/theme/themes'

describe('theme preference store', () => {
  it('is system when nothing is saved', async () => {
    expect(await readThemePref()).toBe('system')
  })
  it('saves and reads a theme slug', async () => {
    await saveThemePref('gruvbox-dark')
    expect(await readThemePref()).toBe('gruvbox-dark')
  })
  it('reads an unknown stored value as system', async () => {
    await writeConfig(CONFIG_KEY, 'bogus')
    expect(await readThemePref()).toBe('system')
  })
  it('stores only known slugs', async () => {
    await saveThemePref('<script>')
    expect(await readThemePref()).toBe('system')
  })
})
