/**
 * Stateless MCP server over streamable HTTP: one JSON-RPC request per POST, one JSON response.
 * No SSE stream and no sessions; the tools are read-only and answer at once.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { getLastMirrorSync } from '@/src/dashboards/mirror'
import { maskDeep } from './mask'
import { TOOLS } from './tools'

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'wallet-sync', version: '0.1.0' }
const INSTRUCTIONS = 'Read-only Wallet data. Amounts are decimals in the currency named next to them. '
  + 'asOf is the last Wallet mirror sync. IBANs and bank account numbers show only their last 4 characters.'

type Id = string | number | null
type Rpc = { id?: Id; method?: unknown; params?: { protocolVersion?: unknown; name?: unknown; arguments?: unknown } }

const digest = (s: string) => createHash('sha256').update(s).digest()
const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

/** Constant-time check of `Authorization: Bearer <token>`. */
export function authorized(header: string | null, token: string): boolean {
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${token}`))
}

export async function handleMcp(req: Request, token: string | undefined): Promise<Response> {
  if (!token) return new Response('not found', { status: 404 })
  if (!authorized(req.headers.get('authorization'), token)) {
    return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } })
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } })

  let msg: Rpc
  try { msg = await req.json() } catch { return Response.json(rpcError(null, -32700, 'parse error'), { status: 400 }) }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return Response.json(rpcError(null, -32600, 'invalid request'), { status: 400 })
  }
  if (msg.id === undefined) return new Response(null, { status: 202 })
  return Response.json(await dispatch(msg.id, msg.method, msg.params ?? {}))
}

async function dispatch(id: Id, method: string, params: NonNullable<Rpc['params']>) {
  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion)
      return {
        jsonrpc: '2.0', id, result: {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS,
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return {
        jsonrpc: '2.0', id, result: {
          tools: TOOLS.map(t => {
            const inputSchema = z.toJSONSchema(t.input, { io: 'input' })
            delete inputSchema.$schema
            return { name: t.name, description: t.description, inputSchema }
          }),
        },
      }
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name)
      if (!tool) return rpcError(id, -32602, `unknown tool: ${String(params.name)}`)
      try {
        const data = await tool.call(params.arguments)
        const asOf = (await getLastMirrorSync())?.toISOString() ?? null
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(maskDeep({ asOf, ...data })) }] } }
      } catch (err) {
        const text = err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err)
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } }
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${method}`)
  }
}
