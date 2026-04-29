type Auth = { login: string; token: string }

export type CouchError =
  | { kind: 'unauthorized'; status: number }
  | { kind: 'rate_limited'; status: 429; retryAfter?: number }
  | { kind: 'http'; status: number; body: string }
  | { kind: 'network'; cause: unknown }

export type BulkDocResult =
  | { id: string; status: 'inserted'; rev: string }
  | { id: string; status: 'conflict' }
  | { id: string; status: 'error'; reason: string }

export class CouchClient {
  constructor(private readonly cfg: { url: string; dbName: string; auth: Auth }) {}

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.cfg.auth.login}:${this.cfg.auth.token}`).toString('base64')}`
  }

  private url(path: string): string { return `${this.cfg.url}/${this.cfg.dbName}${path}` }

  private async req(path: string, init?: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await fetch(this.url(path), {
        ...init,
        headers: {
          'authorization': this.authHeader,
          'content-type': 'application/json',
          'accept': 'application/json',
          ...init?.headers,
        },
      })
    } catch (cause) { throw { kind: 'network', cause } satisfies CouchError }
    if (res.status === 401 || res.status === 403) throw { kind: 'unauthorized', status: res.status } satisfies CouchError
    if (res.status === 429) {
      const ra = res.headers.get('retry-after')
      throw { kind: 'rate_limited', status: 429, retryAfter: ra ? Number(ra) : undefined } satisfies CouchError
    }
    if (!res.ok) throw { kind: 'http', status: res.status, body: await res.text() } satisfies CouchError
    return res
  }

  async bulkDocs(docs: Array<Record<string, unknown>>): Promise<BulkDocResult[]> {
    if (docs.length === 0) return []
    const res = await this.req('/_bulk_docs', { method: 'POST', body: JSON.stringify({ docs, new_edits: true }) })
    const arr = (await res.json()) as Array<{ id: string; ok?: boolean; rev?: string; error?: string; reason?: string }>
    return arr.map(r => {
      if (r.ok) return { id: r.id, status: 'inserted', rev: r.rev! }
      if (r.error === 'conflict') return { id: r.id, status: 'conflict' }
      return { id: r.id, status: 'error', reason: r.reason ?? r.error ?? 'unknown' }
    })
  }

  async listAssetTransactions(accountId: string): Promise<Array<Record<string, unknown>>> {
    return this.list(d => d['reservedModelType'] === 'AssetTransaction' && d['accountId'] === accountId)
  }

  async listRecords(accountId: string): Promise<Array<Record<string, unknown>>> {
    return this.list(d => d['reservedModelType'] === 'Record' && d['accountId'] === accountId)
  }

  async listByModelType<T extends Record<string, unknown> = Record<string, unknown>>(modelType: string): Promise<T[]> {
    return this.list(d => d['reservedModelType'] === modelType) as Promise<T[]>
  }

  private async list(predicate: (doc: Record<string, unknown>) => boolean): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    let since: number | string = 0
    while (true) {
      const params = new URLSearchParams({ include_docs: 'true', style: 'main_only', since: String(since), limit: '500' })
      const res = await this.req(`/_changes?${params}`)
      const data = (await res.json()) as { results: Array<{ id: string; doc?: Record<string, unknown> }>; last_seq: number | string }
      for (const r of data.results) {
        if (r.doc && !r.doc['_deleted'] && predicate(r.doc)) out.push(r.doc)
      }
      if (data.last_seq === since || data.results.length === 0) break
      since = data.last_seq
    }
    return out
  }

  /**
   * Walk the _changes feed from `since` to the current head, yielding every
   * change (including deletions). The caller is responsible for upserting/
   * removing rows in its own store and persisting the returned `lastSeq`.
   */
  async *changesSince(since: string | number): AsyncGenerator<{
    id: string
    deleted: boolean
    doc: Record<string, unknown> | null
    seq: string | number
  }, { lastSeq: string | number }, void> {
    let cursor: string | number = since
    let lastSeq: string | number = since
    while (true) {
      const params = new URLSearchParams({ include_docs: 'true', style: 'main_only', since: String(cursor), limit: '500' })
      const res = await this.req(`/_changes?${params}`)
      const data = (await res.json()) as {
        results: Array<{ id: string; deleted?: boolean; seq: string | number; doc?: Record<string, unknown> }>
        last_seq: string | number
      }
      for (const r of data.results) {
        const isDeleted = r.deleted === true || (r.doc?.['_deleted'] === true)
        yield { id: r.id, deleted: isDeleted, doc: isDeleted ? null : (r.doc ?? null), seq: r.seq }
      }
      lastSeq = data.last_seq
      if (lastSeq === cursor || data.results.length === 0) break
      cursor = lastSeq
    }
    return { lastSeq }
  }
}
