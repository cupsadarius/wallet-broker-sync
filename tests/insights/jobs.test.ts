import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db, runMigrations: () => {} }
})
vi.mock('@/src/push/push', () => ({ sendPush: vi.fn() }))
vi.mock('@/src/dashboards/prices', () => ({ latestFx: vi.fn(async () => 1) }))
vi.mock('@/src/ask/opencode', () => ({ createClient: () => ({}) }))
vi.mock('@/src/ask/run', () => ({ complete: vi.fn() }))
vi.mock('@/src/dashboards/mirror', async importOriginal => ({
  ...(await importOriginal<typeof import('@/src/dashboards/mirror')>()),
  readMirror: vi.fn(),
}))

import { sendPush } from '@/src/push/push'
import { complete } from '@/src/ask/run'
import { readMirror, type MirrorSnapshot } from '@/src/dashboards/mirror'
import { db } from '@/src/storage/db'
import { budgetProposal, config, weeklyNote } from '@/src/storage/schema'
import { maybeWriteWeeklyNote, proposeBudgets, writeNoteNow } from '@/src/insights/jobs'

const groceries = { id: 'groceries', name: 'Groceries', envelopeId: 1000, groupName: 'Food & Drinks' }
const snapshot = {
  accounts: [], assets: [], transactions: [], rules: [], labels: [], categories: [groceries],
  records: [{
    id: 'r1', accountId: 'bt', categoryId: 'groceries', amount: 60_000, recordType: 1, currencyCode: 'RON',
    recordDate: '2026-10-10', isTradeFallback: false, transfer: false, bankSynced: true,
  }],
  budgets: [{
    id: '-Budget_g', name: 'Groceries', currencyCode: null, amount: 50_000, changes: [], type: 1,
    envelopes: [1000], categoryIds: [], accountIds: [], labelIds: [], closed: false,
  }],
  byAssetId: new Map(), byAccountId: new Map(), byCategoryId: new Map([['groceries', groceries]]),
} satisfies MirrorSnapshot

const MONDAY_9 = new Date('2026-11-16T07:00:00Z')
const GOOD = 'Groceries cost 600 RON last month, against 100 on average. Plan meals for the week.'

describe('maybeWriteWeeklyNote', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(readMirror).mockResolvedValue(snapshot)
    vi.mocked(sendPush).mockResolvedValue('sent')
    await db.delete(config)
    await db.delete(weeklyNote)
  })

  it('writes one note a week and pushes it', async () => {
    vi.mocked(complete).mockResolvedValue(GOOD)
    await maybeWriteWeeklyNote(MONDAY_9)
    await maybeWriteWeeklyNote(new Date('2026-11-16T09:00:00Z'))
    expect(await db.select().from(weeklyNote)).toEqual([expect.objectContaining({ week: '2026-11-16', text: GOOD, status: 'ok' })])
    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(sendPush).toHaveBeenCalledWith({ title: 'Your weekly money note is ready', body: expect.any(String), url: '/spending#note' })
    expect(vi.mocked(complete).mock.calls[0][1]).toContain('"lastMonth":{"month":"2026-10","total":600')
  })

  it('tries again an hour later when the AI is not reachable', async () => {
    vi.mocked(complete).mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue(GOOD)
    await expect(maybeWriteWeeklyNote(MONDAY_9)).rejects.toThrow('fetch failed')
    await maybeWriteWeeklyNote(new Date('2026-11-16T07:30:00Z'))
    expect(await db.select().from(weeklyNote)).toEqual([])
    await maybeWriteWeeklyNote(new Date('2026-11-16T08:01:00Z'))
    expect(await db.select().from(weeklyNote)).toHaveLength(1)
  })

  it('"Write now" writes the note on demand and counts it as the week\'s note', async () => {
    vi.mocked(complete).mockResolvedValue(GOOD)
    expect(await writeNoteNow(new Date('2026-11-17T10:00:00Z'))).toMatchObject({ status: 'ok' })
    await maybeWriteWeeklyNote(new Date('2026-11-17T11:00:00Z'))
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('stores a note that fails the number check twice as flagged, and does not push it', async () => {
    vi.mocked(complete).mockResolvedValue('Groceries cost 610 RON.')
    await maybeWriteWeeklyNote(MONDAY_9)
    expect(await db.select().from(weeklyNote)).toEqual([expect.objectContaining({ status: 'flagged', problem: 'Numbers not in the figures: 610' })])
    expect(sendPush).not.toHaveBeenCalled()
    await maybeWriteWeeklyNote(new Date('2026-11-16T09:00:00Z'))
    expect(complete).toHaveBeenCalledTimes(2)
  })
})

describe('proposeBudgets', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(readMirror).mockResolvedValue(snapshot)
    await db.delete(budgetProposal)
  })

  it('stores each new proposal once; a rejected one stays rejected', async () => {
    vi.mocked(complete).mockResolvedValue('{"proposals":[{"budgetId":"-Budget_g","limit":650,"reason":"You spend about 600."}]}')
    expect(await proposeBudgets(new Date('2026-11-17T10:00:00Z'))).toBe('stored')
    await db.update(budgetProposal).set({ status: 'rejected' })
    expect(await proposeBudgets(new Date('2026-11-18T10:00:00Z'))).toBe('stored')
    expect(await db.select().from(budgetProposal)).toEqual([expect.objectContaining({
      budgetId: '-Budget_g', currentLimit: 50_000, limit: 65_000, reason: 'You spend about 600.', status: 'rejected',
    })])
    expect(vi.mocked(complete).mock.calls[0][1]).toContain('"spent":{"2025-11":0,')
  })

  it('tells an unreachable AI apart from an unusable reply', async () => {
    vi.mocked(complete).mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce('no idea')
    expect(await proposeBudgets()).toBe('unavailable')
    expect(await proposeBudgets()).toBe('invalid')
  })
})
