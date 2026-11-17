import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { manualLink } from '@/src/storage/schema'


export async function GET() {
  const links = await db.select().from(manualLink)
  return NextResponse.json({ links })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const broker = url.searchParams.get('broker')
  const externalId = url.searchParams.get('externalId')
  const existingDocId = url.searchParams.get('existingDocId')
  if (!broker || !externalId) {
    return NextResponse.json({ ok: false, error: 'broker, externalId required' }, { status: 400 })
  }
  // If existingDocId is provided, delete just that one link; otherwise unlink
  // the broker trade entirely (all rows for this (broker, externalId)).
  const conditions = [eq(manualLink.broker, broker), eq(manualLink.externalId, externalId)]
  if (existingDocId) conditions.push(eq(manualLink.existingDocId, existingDocId))
  await db.delete(manualLink).where(and(...conditions))
  return NextResponse.json({ ok: true })
}
