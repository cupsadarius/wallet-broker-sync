import { generateVAPIDKeys, sendNotification } from 'web-push'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { config } from '@/src/storage/schema'

const VAPID_KEY = 'push.vapid'
const SUB_KEY = 'push.subscription'
const TTL_SECONDS = 6 * 60 * 60

export const subscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})
export type PushSubscription = z.infer<typeof subscriptionSchema>
export type PushMessage = { title: string; body: string; url: string }

async function getValue(key: string): Promise<string | null> {
  const rows = await db.select().from(config).where(eq(config.key, key)).limit(1)
  return rows[0]?.value ?? null
}
async function setValue(key: string, value: string): Promise<void> {
  await db.insert(config).values({ key, value }).onConflictDoUpdate({ target: config.key, set: { value } })
}

async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const stored = await getValue(VAPID_KEY)
  if (stored) return JSON.parse(stored)
  const keys = generateVAPIDKeys()
  await setValue(VAPID_KEY, JSON.stringify(keys))
  return keys
}

export async function getVapidPublicKey(): Promise<string> {
  return (await getVapidKeys()).publicKey
}

export async function saveSubscription(sub: PushSubscription): Promise<void> {
  await setValue(SUB_KEY, JSON.stringify(sub))
}

export async function clearSubscription(): Promise<void> {
  await db.delete(config).where(eq(config.key, SUB_KEY))
}

export async function sendPush(msg: PushMessage): Promise<'sent' | 'no-subscription' | 'gone'> {
  const stored = await getValue(SUB_KEY)
  if (!stored) return 'no-subscription'
  const { publicKey, privateKey } = await getVapidKeys()
  try {
    await sendNotification(JSON.parse(stored), JSON.stringify(msg), {
      TTL: TTL_SECONDS,
      vapidDetails: { subject: process.env.WALLET_VAPID_SUBJECT || 'mailto:wallet-sync@localhost', publicKey, privateKey },
    })
    return 'sent'
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) {
      await clearSubscription()
      return 'gone'
    }
    throw err
  }
}
