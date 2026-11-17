export type AccessPolicy = { users: Set<string>; hosts: Set<string>; requireUser: boolean }
export type AccessRequest = {
  method: string; path: string; host: string
  login: string | null; contentType: string | null; origin: string | null
}
export type AccessDenied = { status: 403 | 421; reason: string }

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const WRITE_TYPES = new Set(['application/json', 'multipart/form-data'])
const PUBLIC_PATH = '/api/health'

const list = (v: string | undefined) =>
  (v ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

/** Lower-cases a Host value and drops the port; IPv6 keeps its brackets. */
function hostName(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1)
  return h.split(':')[0]
}

/** Parses Host with the Origin's scheme, so an explicit default port (`:443`) still matches. */
function sameOrigin(origin: string, host: string): boolean {
  try {
    const o = new URL(origin)
    return o.host === new URL(`${o.protocol}//${host.trim()}`).host
  } catch {
    return false // "null" or malformed
  }
}

export function policyFromEnv(env: Record<string, string | undefined>): AccessPolicy {
  const users = new Set(list(env.WALLET_ALLOWED_USERS))
  const extraHosts = list(env.WALLET_ALLOWED_HOSTS)
  const withPort = extraHosts.filter(h => hostName(h) !== h)
  if (withPort.length) throw new Error(`WALLET_ALLOWED_HOSTS entries must not have a port: ${withPort.join(', ')}`)
  const production = env.NODE_ENV === 'production'
  if (production && users.size === 0) throw new Error('WALLET_ALLOWED_USERS is required in production')
  return { users, hosts: new Set([...LOOPBACK, ...extraHosts]), requireUser: production || users.size > 0 }
}

export function checkAccess(req: AccessRequest, policy: AccessPolicy): AccessDenied | null {
  if (!policy.hosts.has(hostName(req.host))) return { status: 421, reason: 'unknown host' }

  if (req.path !== PUBLIC_PATH && policy.requireUser && !policy.users.has((req.login ?? '').trim().toLowerCase())) {
    return { status: 403, reason: 'not allowed' }
  }

  if (SAFE_METHODS.has(req.method.toUpperCase())) return null

  // A write with no body has no content type; the Origin check below still covers it.
  const type = req.contentType?.split(';')[0].trim().toLowerCase()
  if (type && !WRITE_TYPES.has(type)) return { status: 403, reason: 'unsupported write' }

  if (req.origin !== null && !sameOrigin(req.origin, req.host)) return { status: 403, reason: 'cross-origin write' }
  return null
}
