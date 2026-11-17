import { NextResponse } from 'next/server'
import { sendPush } from '@/src/push/push'

export async function POST() {
  const result = await sendPush({ title: 'Wallet', body: 'Notifications work.', url: '/' })
  return NextResponse.json({ ok: result === 'sent', result })
}
