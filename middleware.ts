import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/server/admin-auth'
import { updateSession, withAuthCookies } from '@/lib/supabase/middleware'

// Paths that must stay reachable without an admin session — the login page/form
// and the login API it posts to. Everything else under /admin and /api/admin
// requires a valid session cookie.
const ADMIN_PUBLIC_PATHS = new Set([
  '/admin/login',
  '/api/admin/login',
  '/api/admin/logout',
])

/**
 * Server-to-server endpoints that must not pay for a Supabase auth round-trip.
 * The NOWPayments IPN is called by their infrastructure and authenticates
 * itself with an HMAC signature, so there is never a user session to refresh.
 */
const SESSION_REFRESH_EXEMPT = new Set(['/api/payments/crypto/webhook'])

function isAdminPath(pathname: string) {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/api/admin/')
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (SESSION_REFRESH_EXEMPT.has(pathname)) {
    return NextResponse.next()
  }

  // Always refresh first: the rotated auth cookies have to ride along on
  // whatever response we end up returning, including redirects.
  const { response } = await updateSession(request)

  // The admin console is a separate, self-contained auth system (password +
  // signed session cookie). It is intentionally NOT a Supabase user, so the
  // gate below is unchanged by the Supabase migration.
  if (!isAdminPath(pathname) || ADMIN_PUBLIC_PATHS.has(pathname)) {
    return response
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  if (await isValidSessionToken(token)) {
    return response
  }

  // Any direct, unauthenticated hit on the admin panel or its APIs is
  // redirected straight to the homepage rather than to a login prompt.
  if (pathname.startsWith('/api/')) {
    return withAuthCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      response,
    )
  }

  return withAuthCookies(NextResponse.redirect(new URL('/', request.url)), response)
}

export const config = {
  matcher: [
    /*
     * Widened from the admin-only matcher: Supabase tokens must be refreshed on
     * every navigation, not just under /admin. Static assets and image
     * optimiser requests are excluded — they carry no session and running the
     * auth round-trip on them would be pure latency.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon|opengraph-image|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}
