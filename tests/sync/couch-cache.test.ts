import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db }
})

import { eq } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { config, couchCacheMeta } from '@/src/storage/schema'
import { refreshCache, TYPES } from '@/src/sync/couch-cache'

const SCOPE = 'https://couch.example|bb-1'

function fakeClient() {
  const calls: Array<string | number> = []
  return {
    calls,
    async *changesSince(since: string | number) {
      calls.push(since)
      yield* []
      return { lastSeq: since }
    },
  }
}

async function storedTypes() {
  const rows = await db.select().from(config).where(eq(config.key, 'couchCache.types'))
  return rows[0]?.value
}

describe('refreshCache type list', () => {
  beforeEach(async () => {
    await db.delete(config)
    await db.delete(couchCacheMeta)
    await db.insert(couchCacheMeta).values({ scope: SCOPE, lastSeq: '42-abc' })
  })

  it('refetches from since=0 when the cached type list changes', async () => {
    await db.insert(config).values({ key: 'couchCache.types', value: 'Account,Record' })
    const client = fakeClient()
    await refreshCache(client, SCOPE)
    expect(client.calls[0]).toBe(0)
    expect(await storedTypes()).toBe(TYPES.join(','))
  })

  it('resumes from last_seq when the type list is unchanged', async () => {
    await db.insert(config).values({ key: 'couchCache.types', value: TYPES.join(',') })
    const client = fakeClient()
    await refreshCache(client, SCOPE)
    expect(client.calls[0]).toBe('42-abc')
  })
})
