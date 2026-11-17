import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getChat, listChats } from '@/src/ask/store'
import Answer from './Answer'
import Composer from './Composer'

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export default async function AskPage({ searchParams }: { searchParams: Promise<{ chat?: string }> }) {
  const { chat: raw } = await searchParams
  if (!raw) {
    const chats = await listChats()
    return (
      <main className="mx-auto max-w-xl px-4 pb-24">
        <h1 className="text-2xl font-semibold">Ask</h1>
        <p className="mt-1 text-sm text-muted-foreground">Questions about your money, answered from your own data.</p>
        <ul className="mt-4 divide-y divide-border/60 rounded-xl border bg-card">
          {chats.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No chats yet.</li>}
          {chats.map(c => (
            <li key={c.id}>
              <Link href={`/ask?chat=${c.id}`} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="truncate text-sm">{c.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{day(c.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Composer chatId={null} />
      </main>
    )
  }
  const chat = await getChat(Number(raw))
  if (!chat) notFound()
  const busy = chat.messages.some(m => m.status === 'running')
  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <div className="flex items-center gap-1">
        <Link href="/ask" aria-label="All chats" className="-ml-2 grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent">
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="truncate text-base font-semibold">{chat.title}</h1>
      </div>
      <div className="mt-3 flex flex-col gap-4">
        {chat.messages.map(m => m.role === 'user'
          ? <p key={m.id} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-sm">{m.text}</p>
          : <Answer key={m.id} message={m} />)}
      </div>
      <Composer chatId={chat.id} busy={busy} />
    </main>
  )
}
