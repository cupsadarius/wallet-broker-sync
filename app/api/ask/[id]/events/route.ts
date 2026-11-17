import { NextResponse } from 'next/server'
import { finishMessage, getMessage } from '@/src/ask/store'
import { watch, type JobEvent } from '@/src/ask/jobs'

const PING_MS = 15_000

/** The answer's progress as server-sent events: a snapshot, then deltas and tools, then `done` with the stored message. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id)
  if (!(await getMessage(id))) return NextResponse.json({ error: 'No such message.' }, { status: 404 })
  const enc = new TextEncoder()
  let stop = () => {}
  const stream = new ReadableStream({
    async start(c) {
      let closed = false
      const send = (e: JobEvent) => { if (!closed) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)) }
      const ping = setInterval(() => { if (!closed) c.enqueue(enc.encode(': ping\n\n')) }, PING_MS)
      let unwatch: (() => void) | null = null
      stop = () => {
        if (closed) return
        closed = true
        clearInterval(ping)
        unwatch?.()
        c.close()
      }
      req.signal.addEventListener('abort', stop)
      unwatch = watch(id, e => { send(e); if (e.type === 'done') stop() })
      if (unwatch) return
      let m = await getMessage(id)
      if (m?.status === 'running') {
        // No job runs for a running answer only after a restart.
        await finishMessage(id, { status: 'failed', text: 'The answer stopped when the app restarted. Ask again.', spec: null, tools: null })
        m = await getMessage(id)
      }
      if (m) send({ type: 'done', message: m })
      stop()
    },
    cancel() { stop() },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  })
}
