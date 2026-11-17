import { describe, it, expect } from 'vitest'
import { createClient, OpencodeError } from '@/src/ask/opencode'

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

function fakeFetch(reply: (c: Call) => Response) {
  const calls: Call[] = []
  const fn = (async (url: string, init: RequestInit = {}) => {
    const c = {
      url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(c)
    return reply(c)
  }) as unknown as typeof fetch
  return { fn, calls }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

function sse(chunks: string[]) {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close() },
  }), { headers: { 'content-type': 'text/event-stream' } })
}

describe('opencode client', () => {
  it('creates a session with the model, the folder and the permission rules, with basic auth', async () => {
    const f = fakeFetch(() => json({ data: { id: 'ses_1' } }))
    const oc = createClient('http://opencode:4096/', 'pw', f.fn)
    const rules = [{ action: '*', resource: '*', effect: 'deny' as const }]
    expect(await oc.createSession('Ask', rules, 'wallet-sync')).toBe('ses_1')
    expect(f.calls[0].url).toBe('http://opencode:4096/api/session')
    expect(f.calls[0].method).toBe('POST')
    expect(f.calls[0].headers.authorization).toBe(`Basic ${Buffer.from('opencode:pw').toString('base64')}`)
    expect(f.calls[0].body).toEqual({
      title: 'Ask', model: { providerID: 'opencode-go', id: 'claude-haiku-5-5' },
      location: { directory: '/work' }, permissions: rules, agent: 'wallet-sync',
    })
  })

  it('sends a prompt as text', async () => {
    const f = fakeFetch(() => json({ data: {} }))
    await createClient('http://oc', 'pw', f.fn).prompt('ses_1', 'Hi')
    expect(f.calls[0]).toMatchObject({ url: 'http://oc/api/session/ses_1/prompt', method: 'POST', body: { text: 'Hi' } })
  })

  it('reads every message page by page', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, type: 'user' }))
    const f = fakeFetch(c => c.url.includes('cursor=')
      ? json({ data: [{ id: 'last', type: 'idle', outcome: 'succeeded' }], cursor: { next: 'n2' } })
      : json({ data: page1, cursor: { next: 'a/b' } }))
    const msgs = await createClient('http://oc', 'pw', f.fn).messages('ses_1')
    expect(msgs).toHaveLength(201)
    expect(f.calls[0].url).toBe('http://oc/api/session/ses_1/message?order=asc&limit=200')
    expect(f.calls[1].url).toBe('http://oc/api/session/ses_1/message?cursor=a%2Fb&limit=200')
  })

  it('parses server-sent events split across chunks and skips heartbeats', async () => {
    const e1 = JSON.stringify({ type: 'session.text.delta', data: { sessionID: 's', delta: 'He' } })
    const e2 = JSON.stringify({ type: 'session.execution.succeeded', data: { sessionID: 's' } })
    const f = fakeFetch(() => sse([`data: ${e1.slice(0, 10)}`, `${e1.slice(10)}\n\n: heartbeat\n\n`, `data: ${e2}\n\n`]))
    const events = []
    for await (const e of await createClient('http://oc', 'pw', f.fn).subscribe(new AbortController().signal)) events.push(e)
    expect(f.calls[0].url).toBe('http://oc/api/event')
    expect(events.map(e => e.type)).toEqual(['session.text.delta', 'session.execution.succeeded'])
    expect(events[0].data.delta).toBe('He')
  })

  it('throws OpencodeError with the HTTP status', async () => {
    const f = fakeFetch(() => new Response('no', { status: 404 }))
    const err = await createClient('http://oc', 'pw', f.fn).prompt('gone', 'x').catch(e => e)
    expect(err).toBeInstanceOf(OpencodeError)
    expect(err.status).toBe(404)
  })
})
