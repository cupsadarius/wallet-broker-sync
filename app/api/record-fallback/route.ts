import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { recordFallback } from '@/src/storage/schema'


const RuleSchema = z.object({
  broker: z.string().min(1),
  exchange: z.string().min(1),
  symbol: z.string().min(1),
})

export async function GET() {
  const rules = await db.select().from(recordFallback)
  return NextResponse.json({ rules })
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const parsed = RuleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 })
  }
  const { broker, exchange, symbol } = parsed.data
  await db
    .insert(recordFallback)
    .values({ broker, exchange: exchange.toUpperCase(), symbol: symbol.toUpperCase() })
    .onConflictDoNothing()
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const broker = url.searchParams.get('broker')
  const exchange = url.searchParams.get('exchange')
  const symbol = url.searchParams.get('symbol')
  if (!broker || !exchange || !symbol) {
    return NextResponse.json({ ok: false, error: 'broker, exchange, symbol required' }, { status: 400 })
  }
  await db
    .delete(recordFallback)
    .where(
      and(
        eq(recordFallback.broker, broker),
        eq(recordFallback.exchange, exchange.toUpperCase()),
        eq(recordFallback.symbol, symbol.toUpperCase()),
      ),
    )
  return NextResponse.json({ ok: true })
}
