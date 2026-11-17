import { eq } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { config } from '@/src/storage/schema'
import { sendPush } from './push'
import type { Task } from '@/src/dashboards/compute/today'

const SENT_KEY = 'push.sentTasks'

/** Push each new upload task once; a task counts as sent only after a delivered push. */
export async function notifyNewTasks(tasks: Task[]): Promise<void> {
  const rows = await db.select().from(config).where(eq(config.key, SENT_KEY)).limit(1)
  const sent = new Set<string>(rows[0] ? JSON.parse(rows[0].value) : [])
  const fresh = tasks.filter(t => t.kind === 'upload' && !sent.has(t.id))
  if (fresh.length === 0) return
  for (const t of fresh) {
    if (await sendPush({ title: t.title, body: t.detail, url: t.href ?? '/' }) === 'sent') sent.add(t.id)
  }
  const value = JSON.stringify([...sent])
  await db.insert(config).values({ key: SENT_KEY, value }).onConflictDoUpdate({ target: config.key, set: { value } })
}
