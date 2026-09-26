import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/server/admin-auth'
import { cameThroughEdge, isEdgeLockConfigured } from '@/lib/server/client-ip'
import { isCrossSiteWrite } from '@/lib/server/csrf'
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
 * Both payment webhooks are called by the provider's infrastructure and
 * authenticate themselves — NOWPayments with an HMAC signature, Stripe with a
 * signed timestamp — so there is never a user session to refresh.
 *
 * It is not only waste: the refresh is a network call, and a slow or
 * unreachable Supabase would add its latency to every webhook delivery, which
 * is how a provider starts seeing timeouts and retrying payments that already
 * succeeded.
 */
const SESSION_REFRESH_EXEMPT = new Set([
  '/api/payments/crypto/webhook',
  '/api/payments/stripe/webhook',
])

/**
 * Reachable without passing through Cloudflare even when the origin lock is
 * on. The cron routes are invoked by Vercel's scheduler, which calls the
 * deployment directly rather than through the public domain, and each one
 * already demands CRON_SECRET as a bearer token.
 */
const EDGE_LOCK_EXEMPT_PREFIXES = ['/api/cron/']

/**
 * Origin lock: with EDGE_ORIGIN_SECRET set, a production request that did not
 * come through Cloudflare is refused. Without it, the *.vercel.app address
 * is a way around every WAF and rate-limiting rule configured at the edge
 * (docs/security/phase-1-perimeter.md). Off in development, so a local
 * .env with the secret in it does not lock out localhost.
 */
function isEdgeBypass(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production' || !isEdgeLockConfigured()) return false
  const { pathname } = request.nextUrl
  if (EDGE_LOCK_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false
  return !cameThroughEdge(request.headers)
}

function isAdminPath(pathname: string) {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/api/admin/')
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isEdgeBypass(request)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // CSRF: a state-changing request a browser marks as cross-site is refused
  // before any handler, cookie refresh or session check runs (lib/server/csrf.ts).
  if (isCrossSiteWrite(request.method, pathname, request.headers)) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 })
  }

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
    '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|webmanifest)$).*)',
  ],
}
