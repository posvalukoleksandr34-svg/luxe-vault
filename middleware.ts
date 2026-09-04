import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/server/admin-auth'

// Paths that must stay reachable without a session — the login page/form and
// the login API it posts to. Everything else under /admin and /api/admin
// requires a valid session cookie.
const PUBLIC_PATHS = new Set(['/admin/login', '/api/admin/login', '/api/admin/logout'])

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  const authorized = await isValidSessionToken(token)

  if (authorized) {
    return NextResponse.next()
  }

  // Any direct, unauthenticated hit on the admin panel or its APIs is
  // redirected straight to the homepage rather than to a login prompt.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.redirect(new URL('/', request.url))
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'],
}
