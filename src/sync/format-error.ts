/**
 * Renders any error into a structured shape suitable for logging + JSON responses.
 * Specifically handles the CouchError discriminated-union thrown by CouchClient
 * (plain objects, NOT Error instances), so `err.message` is undefined for those.
 */
export type FormattedError = {
  kind: string
  message: string
  details?: Record<string, unknown>
}

export function formatError(err: unknown): FormattedError {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const kind = typeof e.kind === 'string' ? e.kind : undefined
    if (kind === 'unauthorized') {
      return { kind, message: `CouchDB rejected credentials (HTTP ${e.status})`, details: { status: e.status } }
    }
    if (kind === 'rate_limited') {
      return { kind, message: `CouchDB rate limit hit; retry-after=${e.retryAfter ?? '?'}s`, details: { retryAfter: e.retryAfter } }
    }
    if (kind === 'http') {
      const bodyStr = typeof e.body === 'string' ? e.body.slice(0, 500) : ''
      return { kind, message: `CouchDB HTTP ${e.status}: ${bodyStr}`, details: { status: e.status, body: bodyStr } }
    }
    if (kind === 'network') {
      const causeMsg = e.cause instanceof Error ? e.cause.message : String(e.cause)
      return { kind, message: `Network error reaching CouchDB: ${causeMsg}`, details: { cause: causeMsg } }
    }
  }
  if (err instanceof Error) {
    return { kind: 'error', message: err.message, details: { stack: err.stack } }
  }
  return { kind: 'unknown', message: String(err) }
}
