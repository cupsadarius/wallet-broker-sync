import { asc, desc, eq } from 'drizzle-orm'
import type { Spec } from '@json-render/core'
import { db } from '@/src/storage/db'
import { askChat, askMessage } from '@/src/storage/schema'
import type { Tools } from './run'

export type AskMessage = typeof askMessage.$inferSelect
export type Finished = { status: 'done' | 'failed'; text: string; spec: Spec | null; tools: Tools | null }

/** Saves a question (in a new chat when `chatId` is null) and the empty answer that a job fills. */
export async function ask(chatId: number | null, question: string, now = Date.now()): Promise<{ chatId: number; messageId: number }> {
  return db.transaction(tx => {
    const chat = chatId === null
      ? tx.insert(askChat).values({ title: question.slice(0, 80), createdAt: now, updatedAt: now }).returning().get()
      : tx.update(askChat).set({ updatedAt: now }).where(eq(askChat.id, chatId)).returning().get()
    if (!chat) throw new Error(`No chat ${chatId}`)
    tx.insert(askMessage).values({ chatId: chat.id, role: 'user', status: 'done', text: question, createdAt: now }).run()
    const m = tx.insert(askMessage).values({ chatId: chat.id, role: 'assistant', status: 'running', text: '', createdAt: now }).returning().get()
    return { chatId: chat.id, messageId: m.id }
  })
}

export async function finishMessage(id: number, f: Finished, now = Date.now()): Promise<void> {
  const [m] = await db.update(askMessage).set(f).where(eq(askMessage.id, id)).returning()
  if (m) await db.update(askChat).set({ updatedAt: now }).where(eq(askChat.id, m.chatId))
}

export async function setChatSession(id: number, sessionId: string): Promise<void> {
  await db.update(askChat).set({ sessionId }).where(eq(askChat.id, id))
}

export async function getMessage(id: number): Promise<AskMessage | undefined> {
  return (await db.select().from(askMessage).where(eq(askMessage.id, id)))[0]
}

export async function listChats() {
  return db.select().from(askChat).orderBy(desc(askChat.updatedAt), desc(askChat.id))
}

export async function getChat(id: number) {
  const [chat] = await db.select().from(askChat).where(eq(askChat.id, id))
  if (!chat) return undefined
  const messages = await db.select().from(askMessage).where(eq(askMessage.chatId, id)).orderBy(asc(askMessage.id))
  return { ...chat, messages }
}
