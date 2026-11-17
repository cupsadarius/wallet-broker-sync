import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  setBaseCurrency, getBaseCurrency,
  DEFAULT_MIRROR_INTERVAL_MS, getMirrorIntervalMs, MIRROR_INTERVAL_KEY,
} from '@/src/dashboards/mirror'
import { db } from '@/src/storage/db'
import { config } from '@/src/storage/schema'
import { formatError } from '@/src/sync/format-error'


const PayloadSchema = z.object({
  baseCurrency: z.string().length(3).optional(),
  mirrorIntervalMs: z.number().int().min(60_000).max(24 * 60 * 60 * 1000).optional(),
})

export async function GET() {
  const [baseCurrency, mirrorIntervalMs] = await Promise.all([
    getBaseCurrency(),
    getMirrorIntervalMs(),
  ])
  return NextResponse.json({
    baseCurrency,
    mirrorIntervalMs,
    defaultMirrorIntervalMs: DEFAULT_MIRROR_INTERVAL_MS,
  })
}

export async function POST(req: Request) {
  try {
    let body: unknown
    try { body = await req.json() } catch {
      return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
    }
    const parsed = PayloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 },
      )
    }
    const data = parsed.data
    if (data.baseCurrency) await setBaseCurrency(data.baseCurrency)
    if (data.mirrorIntervalMs !== undefined) {
      await db
        .insert(config)
        .values({ key: MIRROR_INTERVAL_KEY, value: String(data.mirrorIntervalMs) })
        .onConflictDoUpdate({ target: config.key, set: { value: String(data.mirrorIntervalMs) } })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/dashboard/config]', f.kind, f.message, f.details)
    return NextResponse.json({ ok: false, error: f.message, kind: f.kind }, { status: 500 })
  }
}
