import { NextResponse } from 'next/server'
import { getVapidPublicKey } from '@/src/push/push'

export async function GET() {
  return NextResponse.json({ publicKey: await getVapidPublicKey() })
}
