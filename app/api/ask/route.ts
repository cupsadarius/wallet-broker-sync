import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { ask, getChat } from '@/src/ask/store'
import { runJob } from '@/src/ask/jobs'

const body = z.object({
  chatId: z.number().int().positive().nullable(),
  question: z.string().trim().min(1).max(4000),
})

/** Starts a question as a job that runs on when the phone disconnects; GET /api/ask/<messageId>/events follows it. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Send { chatId, question }.' }, { status: 400 })
  const { chatId, question } = parsed.data
  if (chatId !== null) {
    const chat = await getChat(chatId)
    if (!chat) return NextResponse.json({ error: 'No such chat.' }, { status: 404 })
    if (chat.messages.some(m => m.status === 'running')) {
      return NextResponse.json({ error: 'Wait for the current answer.' }, { status: 409 })
    }
  }
  const ids = await ask(chatId, question)
  after(() => runJob(ids.chatId, ids.messageId, question))
  return NextResponse.json(ids)
}
