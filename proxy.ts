import { NextResponse, type NextRequest } from 'next/server'
import { checkAccess, policyFromEnv } from '@/src/security/access'

const policy = policyFromEnv(process.env)

export function proxy(request: NextRequest) {
  const denied = checkAccess({
    method: request.method,
    path: request.nextUrl.pathname,
    host: request.headers.get('host') ?? '',
    login: request.headers.get('tailscale-user-login'),
    contentType: request.headers.get('content-type'),
    origin: request.headers.get('origin'),
  }, policy)
  return denied ? new NextResponse(denied.reason, { status: denied.status }) : NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
