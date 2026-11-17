import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db }
})
vi.mock('@/src/push/push', () => ({ sendPush: vi.fn() }))

import { sendPush } from '@/src/push/push'
import { db } from '@/src/storage/db'
import { config } from '@/src/storage/schema'
import { notifyNewTasks } from '@/src/push/tasks'
import type { Task } from '@/src/dashboards/compute/today'

const upload: Task = { id: 'upload:xtb:r1', kind: 'upload', title: 'Upload XTB statement', detail: 'd', href: '/upload?broker=xtb' }
const bank: Task = { id: 'bank:Revolut', kind: 'bank', title: 'Reconnect Revolut', detail: 'd' }

describe('notifyNewTasks', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete(config)
  })

  it('pushes each upload task once', async () => {
    vi.mocked(sendPush).mockResolvedValue('sent')
    await notifyNewTasks([upload, bank])
    await notifyNewTasks([upload, bank])
    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(sendPush).toHaveBeenCalledWith({ title: 'Upload XTB statement', body: 'd', url: '/upload?broker=xtb' })
  })

  it('tries again later when no phone is subscribed yet', async () => {
    vi.mocked(sendPush).mockResolvedValueOnce('no-subscription').mockResolvedValueOnce('sent')
    await notifyNewTasks([upload])
    await notifyNewTasks([upload])
    expect(sendPush).toHaveBeenCalledTimes(2)
  })
})
