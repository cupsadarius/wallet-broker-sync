import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getChat, listChats } from '@/src/ask/store'
import { cn } from '@/lib/utils'
import Page from '@/app/ui/Page'
import Answer from './Answer'
import Composer from './Composer'

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export default async function AskPage({ searchParams }: { searchParams: Promise<{ chat?: string }> }) {
  const { chat: raw } = await searchParams
  const [chats, chat] = await Promise.all([listChats(), raw ? getChat(Number(raw)) : null])
  if (raw && !chat) notFound()
  const busy = chat?.messages.some(m => m.status === 'running') ?? false
  return (
    <Page>
      <div className="lg:grid lg:h-[calc(100dvh-6.25rem)] lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Chats" className={cn('flex flex-col gap-3 pt-3 lg:min-h-0 lg:overflow-y-auto lg:pt-0', chat && 'max-lg:hidden')}>
          <div className="flex items-center justify-between gap-3 lg:h-11">
            <h1 className="text-2xl font-semibold tracking-tight lg:text-[28px]">Ask</h1>
            <Link href="/ask" className="flex min-h-9 items-center rounded-lg border border-line-2 px-3 text-[13px] font-semibold">New chat</Link>
          </div>
          <p className="text-sm text-muted-foreground">Questions about your money, answered from your own data.</p>
          <ul className="flex flex-col gap-1">
            {chats.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No chats yet.</li>}
            {chats.map(c => (
              <li key={c.id}>
                <Link href={`/ask?chat=${c.id}`} aria-current={c.id === chat?.id ? 'page' : undefined}
                  className={cn('flex min-h-12 flex-col justify-center rounded-xl px-4 py-2 hover:bg-accent', c.id === chat?.id && 'bg-secondary')}>
                  <span className="truncate text-sm font-medium">{c.title}</span>
                  <span className="text-xs text-muted-foreground">{day(c.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-label={chat?.title ?? 'New chat'} className="mx-auto flex w-full max-w-[760px] flex-col gap-4 lg:min-h-0">
          {chat ? (
            <>
              <div className="flex items-center gap-1 pt-3 lg:h-11 lg:shrink-0 lg:pt-0">
                <Link href="/ask" aria-label="All chats" className="-ml-2 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent lg:hidden">
                  <ChevronLeft className="size-5" />
                </Link>
                <h2 className="truncate text-base font-semibold lg:text-lg">{chat.title}</h2>
              </div>
              <div className="flex flex-col gap-4 lg:-mr-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-4">
                {chat.messages.map(m => m.role === 'user'
                  ? <p key={m.id} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-sm">{m.text}</p>
                  : <Answer key={m.id} message={m} />)}
              </div>
            </>
          ) : (
            <p className="hidden pt-1 text-muted-foreground lg:block lg:flex-1">Ask a question about your money. The answer uses your own data.</p>
          )}
          <Composer chatId={chat?.id ?? null} busy={busy} />
          <div aria-hidden className="h-20 lg:hidden" />
        </section>
      </div>
    </Page>
  )
}
