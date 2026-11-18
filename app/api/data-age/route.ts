import { NextResponse } from 'next/server'
import { loadDataAge } from '@/src/dashboards/portfolio'

export async function GET() {
  return NextResponse.json(await loadDataAge())
}
