import { NextResponse } from 'next/server'
import { ensurePricesForHoldings } from '@/src/dashboards/prices'
import { formatError } from '@/src/sync/format-error'

export async function POST() {
  try {
    const started = Date.now()
    const out = await ensurePricesForHoldings()
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - started,
      symbols: out.resolutions.length,
      withCoverage: out.priceResults.filter(r => r.skipped === null).length,
      unsupported: out.priceResults.filter(r => r.skipped === 'unsupported').map(r => r.symbol),
      noData: out.priceResults.filter(r => r.skipped === 'no_data').map(r => r.symbol),
      fxPairs: out.fxResults.length,
    })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/dashboard/backfill-prices]', f.kind, f.message, f.details)
    return NextResponse.json({ ok: false, error: f.message, kind: f.kind }, { status: 500 })
  }
}
