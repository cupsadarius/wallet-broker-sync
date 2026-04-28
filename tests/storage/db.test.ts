import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { syncRun, syncRunDoc } from '@/src/storage/schema'
import { eq } from 'drizzle-orm'

describe('audit log schema', () => {
  // In-memory DB so the test never touches the user's real audit DB
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)

  beforeAll(() => { migrate(db, { migrationsFolder: 'src/storage/migrations' }) })

  it('inserts and reads a sync_run with detail rows', async () => {
    const ins = await db.insert(syncRun).values({
      startedAt: 1000, finishedAt: 2000, broker: 'xtb',
      accountId: '-Account_a', sourceFilename: 'xtb.xlsx', sourceSha256: 'abc',
      parsedCount: 3, insertedCount: 2, conflictCount: 1, errorCount: 0,
    }).returning()
    expect(ins[0].id).toBeGreaterThan(0)
    await db.insert(syncRunDoc).values([
      { runId: ins[0].id, externalId: 'x1', docId: '-AssetTransaction_d1', status: 'inserted' },
      { runId: ins[0].id, externalId: 'x2', docId: '-AssetTransaction_d2', status: 'conflict' },
    ])
    const detail = await db.select().from(syncRunDoc).where(eq(syncRunDoc.runId, ins[0].id))
    expect(detail).toHaveLength(2)
  })
})
