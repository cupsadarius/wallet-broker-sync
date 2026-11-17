import { NextResponse } from 'next/server'
import { syncMirror, getLastMirrorSync, isMirrorStale, getMirrorIntervalMs } from '@/src/dashboards/mirror'
import { formatError } from '@/src/sync/format-error'

export async function POST() {
  try {
    const started = Date.now()
    const snapshot = await syncMirror()
    if (!snapshot) {
      return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - started,
      counts: {
        accounts: snapshot.accounts.length,
        assets: snapshot.assets.length,
        categories: snapshot.categories.length,
        transactions: snapshot.transactions.length,
        records: snapshot.records.length,
      },
    })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/dashboard/sync]', f.kind, f.message, f.details)
    const status = f.kind === 'unauthorized' ? 401 : f.kind === 'rate_limited' ? 429 : 500
    return NextResponse.json({ ok: false, error: f.message, kind: f.kind }, { status })
  }
}

export async function GET() {
  const [last, interval, stale] = await Promise.all([
    getLastMirrorSync(),
    getMirrorIntervalMs(),
    isMirrorStale(),
  ])
  return NextResponse.json({
    lastSync: last?.toISOString() ?? null,
    intervalMs: interval,
    stale,
  })
}
