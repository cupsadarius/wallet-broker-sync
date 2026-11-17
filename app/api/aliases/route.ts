import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { assetAlias } from '@/src/storage/schema'
import { formatError } from '@/src/sync/format-error'


const BrokerSchema = z.enum(['xtb', 'ibkr', 'tradeville'])
const AliasSchema = z.object({
  broker: BrokerSchema,
  fromSymbol: z.string().min(1),
  fromExchange: z.string().min(1),
  toSymbol: z.string().min(1),
  toExchange: z.string().min(1),
})

export async function GET() {
  try {
    const rows = await db.select().from(assetAlias)
    return NextResponse.json({ aliases: rows })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/aliases GET]', f)
    return NextResponse.json({ error: f.message, kind: f.kind }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = AliasSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 })
    }
    const a = parsed.data
    await db.insert(assetAlias)
      .values({
        broker: a.broker,
        fromSymbol: a.fromSymbol.toUpperCase(),
        fromExchange: a.fromExchange.toUpperCase(),
        toSymbol: a.toSymbol.toUpperCase(),
        toExchange: a.toExchange.toUpperCase(),
      })
      .onConflictDoUpdate({
        target: [assetAlias.broker, assetAlias.fromSymbol, assetAlias.fromExchange],
        set: { toSymbol: a.toSymbol.toUpperCase(), toExchange: a.toExchange.toUpperCase() },
      })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/aliases POST]', f)
    return NextResponse.json({ ok: false, error: f.message, kind: f.kind }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const broker = url.searchParams.get('broker')
    const fromSymbol = url.searchParams.get('fromSymbol')
    const fromExchange = url.searchParams.get('fromExchange')
    if (!broker || !fromSymbol || !fromExchange) {
      return NextResponse.json({ ok: false, error: 'broker, fromSymbol, fromExchange required' }, { status: 400 })
    }
    await db.delete(assetAlias).where(and(
      eq(assetAlias.broker, broker),
      eq(assetAlias.fromSymbol, fromSymbol.toUpperCase()),
      eq(assetAlias.fromExchange, fromExchange.toUpperCase()),
    ))
    return NextResponse.json({ ok: true })
  } catch (err) {
    const f = formatError(err)
    console.error('[api/aliases DELETE]', f)
    return NextResponse.json({ ok: false, error: f.message, kind: f.kind }, { status: 500 })
  }
}
