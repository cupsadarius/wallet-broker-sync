import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db, runMigrations } from '@/src/storage/db'
import { manualLink } from '@/src/storage/schema'

runMigrations()

export async function GET() {
  const links = await db.select().from(manualLink)
  return NextResponse.json({ links })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const broker = url.searchParams.get('broker')
  const externalId = url.searchParams.get('externalId')
  if (!broker || !externalId) {
    return NextResponse.json({ ok: false, error: 'broker, externalId required' }, { status: 400 })
  }
  await db
    .delete(manualLink)
    .where(
      and(
        eq(manualLink.broker, broker),
        eq(manualLink.externalId, externalId),
      ),
    )
  return NextResponse.json({ ok: true })
}
