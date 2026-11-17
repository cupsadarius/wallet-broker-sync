import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db }
})

import { db } from '@/src/storage/db'
import { askChat, askMessage } from '@/src/storage/schema'
import { ask, finishMessage, getChat, getMessage, listChats, setChatSession } from '@/src/ask/store'

const spec = { root: 'a', elements: { a: { type: 'Text', props: { text: 'x' }, children: [] } } }

describe('chat persistence', () => {
  beforeEach(async () => {
    await db.delete(askMessage)
    await db.delete(askChat)
  })

  it('starts a chat with the question and a running answer', async () => {
    const { chatId, messageId } = await ask(null, 'How much cash do I have?', 1000)
    const chat = await getChat(chatId)
    expect(chat?.title).toBe('How much cash do I have?')
    expect(chat?.sessionId).toBeNull()
    expect(chat?.messages.map(m => [m.role, m.text, m.status])).toEqual([
      ['user', 'How much cash do I have?', 'done'],
      ['assistant', '', 'running'],
    ])
    expect(chat?.messages[1].id).toBe(messageId)
  })

  it('adds a follow-up to the same chat and keeps the opencode session', async () => {
    const first = await ask(null, 'Q1', 1000)
    await setChatSession(first.chatId, 'ses_9')
    const second = await ask(first.chatId, 'Q2', 2000)
    expect(second.chatId).toBe(first.chatId)
    const chat = await getChat(first.chatId)
    expect(chat?.sessionId).toBe('ses_9')
    expect(chat?.messages.filter(m => m.role === 'user').map(m => m.text)).toEqual(['Q1', 'Q2'])
  })

  it('stores the finished answer with its spec and tools', async () => {
    const { chatId, messageId } = await ask(null, 'Q', 1000)
    await finishMessage(messageId, { status: 'done', text: 'A', spec, tools: { own: ['wallet_holdings'], web: ['websearch'] } }, 5000)
    const m = await getMessage(messageId)
    expect(m).toMatchObject({ chatId, status: 'done', text: 'A', spec, tools: { own: ['wallet_holdings'], web: ['websearch'] } })
  })

  it('lists chats, the most recently used first', async () => {
    const a = await ask(null, 'Old chat', 1000)
    const b = await ask(null, 'New chat', 2000)
    await ask(a.chatId, 'Follow-up', 3000)
    expect((await listChats()).map(c => c.id)).toEqual([a.chatId, b.chatId])
  })

  it('refuses a follow-up to an unknown chat', async () => {
    await expect(ask(999, 'Q', 1000)).rejects.toThrow()
  })
})
