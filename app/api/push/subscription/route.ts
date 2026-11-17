import { NextResponse } from 'next/server'
import { clearSubscription, saveSubscription, subscriptionSchema } from '@/src/push/push'

export async function PUT(req: Request) {
  const parsed = subscriptionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 })
  }
  await saveSubscription(parsed.data)
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  await clearSubscription()
  return NextResponse.json({ ok: true })
}
