'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AskMessage } from '@/src/ask/store'
import type { JobEvent } from '@/src/ask/jobs'
import type { Tools } from '@/src/ask/run'
import { cn } from '@/lib/utils'
import SpecView from './SpecView'

type Live = { phase: 'research' | 'answer'; text: string; tools: Tools }

/** One answer: streamed while its job runs, then the stored text, spec and tools. */
export default function Answer({ message }: { message: AskMessage }) {
  const router = useRouter()
  const [live, setLive] = useState<Live>({ phase: 'research', text: '', tools: { own: [], web: [] } })
  const running = message.status === 'running'

  useEffect(() => {
    if (!running) return
    const es = new EventSource(`/api/ask/${message.id}/events`)
    es.onmessage = ev => {
      const e = JSON.parse(ev.data) as JobEvent
      if (e.type === 'done') { es.close(); router.refresh(); return }
      setLive(l => {
        if (e.type === 'snapshot') return { phase: e.phase, text: e.text, tools: e.tools }
        if (e.type === 'phase') return { ...l, phase: e.phase }
        if (e.type === 'delta') return { ...l, text: l.text + e.text }
        return l.tools[e.kind].includes(e.name) ? l : { ...l, tools: { ...l.tools, [e.kind]: [...l.tools[e.kind], e.name] } }
      })
    }
    return () => es.close()
  }, [running, message.id, router])

  useEffect(() => { if (running) window.scrollTo({ top: document.body.scrollHeight }) }, [running, live.text])

  if (running) {
    // The spec streams as JSONL after the text; it shows once stored and checked.
    const text = live.text.split('```spec')[0].trim()
    return (
      <div className="flex flex-col gap-2">
        {text ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p> : (
          <p className="animate-pulse text-sm text-muted-foreground">
            {live.phase === 'research' ? 'Checking if the web can help…' : 'Reading your data…'}
          </p>
        )}
        <ToolsLine tools={live.tools} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', message.status === 'failed' && 'text-destructive')}>{message.text}</p>
      {message.spec && <SpecView spec={message.spec} />}
      {message.tools && <ToolsLine tools={message.tools} />}
    </div>
  )
}

function ToolsLine({ tools }: { tools: Tools }) {
  if (!tools.own.length && !tools.web.length) return null
  const own = tools.own.map(t => t.replace(/^wallet_/, '')).join(', ')
  return (
    <p className="text-xs text-muted-foreground">
      Tools used:{own && <> own data: {own}</>}{own && tools.web.length > 0 && ' ·'}{tools.web.length > 0 && <> web: {tools.web.join(', ')}</>}
    </p>
  )
}
