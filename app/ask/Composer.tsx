'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp } from 'lucide-react'

/** The question box, fixed above the bottom bar, or above the keyboard while it is open. */
export default function Composer({ chatId, busy = false }: { chatId: number | null; busy?: boolean }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [keyboard, setKeyboard] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    // iOS keeps fixed elements at the layout viewport's bottom, behind the keyboard.
    const update = () => setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])

  async function send() {
    const question = text.trim()
    if (!question || sending || busy) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/ask', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chatId, question }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setText('')
      if (chatId === null) router.push(`/ask?chat=${body.chatId}`)
      else router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); send() }}
      style={keyboard > 0 ? { bottom: keyboard } : undefined}
      className="fixed inset-x-0 bottom-[calc(61px+env(safe-area-inset-bottom))] z-20 border-t bg-background/95 px-4 py-2 backdrop-blur"
    >
      {error && <p className="mx-auto mb-1 max-w-xl text-xs text-destructive">{error}</p>}
      <div className="mx-auto flex max-w-xl items-end gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
          maxLength={4000}
          placeholder={busy ? 'Answering…' : chatId === null ? 'Ask about your money' : 'Ask a follow-up'}
          aria-label="Question"
          className="field-sizing-content max-h-32 min-h-10 flex-1 resize-none rounded-2xl border bg-card px-3.5 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending || busy}
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
    </form>
  )
}
