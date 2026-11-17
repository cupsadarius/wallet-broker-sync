import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db }
})
vi.mock('web-push', () => ({
  generateVAPIDKeys: vi.fn(() => ({ publicKey: 'pub-1', privateKey: 'priv-1' })),
  sendNotification: vi.fn(),
}))

import * as webpush from 'web-push'
import { eq } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { config } from '@/src/storage/schema'
import { getVapidPublicKey, saveSubscription, sendPush, subscriptionSchema } from '@/src/push/push'

const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }
const MSG = { title: 'Wallet', body: 'hi', url: '/' }

describe('push', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete(config)
  })

  it('sendPush returns no-subscription when none is saved', async () => {
    expect(await sendPush(MSG)).toBe('no-subscription')
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('sendPush clears the subscription on 410 and returns gone', async () => {
    await saveSubscription(SUB)
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 })
    expect(await sendPush(MSG)).toBe('gone')
    const rows = await db.select().from(config).where(eq(config.key, 'push.subscription'))
    expect(rows).toHaveLength(0)
  })

  it('sendPush returns sent when the push service accepts', async () => {
    await saveSubscription(SUB)
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} })
    expect(await sendPush(MSG)).toBe('sent')
  })

  it('getVapidPublicKey generates once and returns the same key on the next call', async () => {
    expect(await getVapidPublicKey()).toBe('pub-1')
    expect(await getVapidPublicKey()).toBe('pub-1')
    expect(webpush.generateVAPIDKeys).toHaveBeenCalledTimes(1)
  })

  it('subscriptionSchema rejects an http endpoint', () => {
    expect(subscriptionSchema.safeParse({ ...SUB, endpoint: 'http://push.example/abc' }).success).toBe(false)
  })
})
