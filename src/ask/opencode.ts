// The opencode server (`opencode serve` in body-ledger's stack), v2 HTTP API. Logs in as user "opencode".
export type Rule = { action: string; resource: string; effect: 'allow' | 'deny' }
export type OcEvent = { type: string; data: Record<string, unknown> }
export type OcPart = { type: string; text?: string; name?: string }
export type OcMessage = { type: string; text?: string; outcome?: string; error?: { message?: string }; content?: OcPart[] }

// The Go plan's tool model, as body-ledger's research job uses. No free models: their providers may keep prompts.
const MODEL = { providerID: 'opencode-go', id: 'claude-haiku-5-5' }
const WORK = '/work'
const PAGE = 200

export class OpencodeError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

export function createClient(
  url = process.env.WALLET_OPENCODE_URL || 'http://opencode:4096',
  password = process.env.WALLET_OPENCODE_PASSWORD ?? '',
  fetchFn: typeof fetch = fetch,
) {
  const base = url.replace(/\/+$/, '')
  const headers = { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` }

  async function send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response
    try {
      res = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal })
    } catch (err) {
      throw new OpencodeError(`${method} ${path}: ${(err as Error).message}`)
    }
    if (!res.ok) throw new OpencodeError(`${method} ${path}: HTTP ${res.status}`, res.status)
    return res
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const raw = await (await send(method, path, body)).text()
    return (raw ? JSON.parse(raw) : null) as T
  }

  return {
    async createSession(title: string, permissions: Rule[], agent?: string): Promise<string> {
      const body = { title, model: MODEL, location: { directory: WORK }, permissions, ...(agent && { agent }) }
      return (await call<{ data: { id: string } }>('POST', '/api/session', body)).data.id
    },
    async prompt(sid: string, text: string): Promise<void> {
      await call('POST', `/api/session/${sid}/prompt`, { text })
    },
    async messages(sid: string): Promise<OcMessage[]> {
      const out: OcMessage[] = []
      let query = `order=asc&limit=${PAGE}`
      for (;;) {
        const page = await call<{ data: OcMessage[]; cursor: { next: string } }>('GET', `/api/session/${sid}/message?${query}`)
        out.push(...page.data)
        if (page.data.length < PAGE) return out
        query = `cursor=${encodeURIComponent(page.cursor.next)}&limit=${PAGE}`
      }
    },
    async interrupt(sid: string): Promise<void> {
      await call('POST', `/api/session/${sid}/interrupt`)
    },
    async deleteSession(sid: string): Promise<void> {
      await call('DELETE', `/api/session/${sid}`)
    },
    /** Every event of the server (all sessions), from the moment this resolves until `signal` aborts. */
    async subscribe(signal: AbortSignal): Promise<AsyncIterable<OcEvent>> {
      const res = await send('GET', '/api/event', undefined, signal)
      return parseSse(res.body!)
    },
  }
}

export type Opencode = ReturnType<typeof createClient>

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<OcEvent> {
  const decoder = new TextDecoder()
  let buf = ''
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buf += decoder.decode(value, { stream: true })
    let end
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const data = buf.slice(0, end).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      buf = buf.slice(end + 2)
      if (data) yield JSON.parse(data) as OcEvent
    }
  }
}
