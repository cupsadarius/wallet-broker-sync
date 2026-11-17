import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { syncRun, syncRunDoc } from '@/src/storage/schema'
import { formatError } from '@/src/sync/format-error'


export type SyncRun = {
  id: number
  startedAt: number
  finishedAt: number | null
  broker: string
  accountId: string
  sourceFilename: string
  sourceSha256: string
  parsedCount: number
  insertedCount: number
  conflictCount: number
  errorCount: number
}

export type SyncRunDoc = {
  id: number
  runId: number
  externalId: string | null
  docId: string | null
  status: string
  errorMessage: string | null
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const runIdParam = url.searchParams.get('runId')

    if (runIdParam !== null) {
      const runId = Number(runIdParam)
      if (!Number.isFinite(runId) || runId <= 0) {
        return NextResponse.json({ ok: false, error: 'invalid runId' }, { status: 400 })
      }

      const runRows = await db.select().from(syncRun).where(eq(syncRun.id, runId))
      if (runRows.length === 0) {
        return NextResponse.json({ ok: false, error: 'run not found' }, { status: 404 })
      }

      const docRows = await db.select().from(syncRunDoc).where(eq(syncRunDoc.runId, runId))

      return NextResponse.json({ run: runRows[0] as SyncRun, docs: docRows as SyncRunDoc[] })
    }

    const runs = await db.select().from(syncRun).orderBy(desc(syncRun.startedAt))
    return NextResponse.json({ runs: runs as SyncRun[] })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/history]', f.kind, f.message, f.details)
    return NextResponse.json({ ok: false, error: f.message, kind: f.kind }, { status: 500 })
  }
}
