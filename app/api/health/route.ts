import { NextResponse } from 'next/server'
import { getLastMirrorSync } from '@/src/dashboards/mirror'

export async function GET() {
  const last = await getLastMirrorSync()
  return NextResponse.json({ ok: true, mirrorSyncedAt: last?.toISOString() ?? null })
}
