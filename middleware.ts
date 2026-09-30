import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/server/admin-auth'
import { cameThroughEdge, isEdgeLockConfigured } from '@/lib/server/client-ip'
import { isCrossSiteWrite } from '@/lib/server/csrf'
import { hasSessionCookie, updateSession, withAuthCookies } from '@/lib/supabase/middleware'

// Paths that must stay reachable without an admin session — the login page/form
// and the login API it posts to. Everything else under /admin and /api/admin
// requires a valid session cookie.
const ADMIN_PUBLIC_PATHS = new Set([
  '/admin/login',
  '/api/admin/login',
  '/api/admin/logout',
])

/**
 * Whether this request should pay for a Supabase session refresh.
 *
 * Only a full page load by a signed-in visitor does. Everything else skips it:
 *
 *  - No session cookie: nobody to refresh — every visitor who has not signed
 *    in, and every server-to-server caller.
 *  - /api/*: each route that needs the user calls getCurrentUser(), and its
 *    server client writes refreshed cookies onto its own response, so the
 *    check here was a second auth round trip on every signed-in API call.
 *    That also keeps the payment webhooks (signed by their providers, never
 *    carrying a session) off the refresh entirely: a slow Supabase must not
 *    add latency to a webhook delivery, or providers time out and retry
 *    payments that already succeeded.
 *  - Anything the page fetches rather than navigates to: link prefetches,
 *    client-side navigations, Server Actions. No page reads the session on
 *    the server, and a Server Action that needs the user checks it itself.
 *    Measured before this: 24 auth round trips for one page view, one per
 *    prefetched link.
 *
 * "Fetched" is read from Sec-Fetch-Dest, which the browser sets and page
 * script cannot: `document` for a page load, `empty` for fetch(). Next's own
 * RSC and prefetch headers would say more, but Next 13.5 deletes them before
 * middleware runs (next/dist/server/web/adapter.js, FLIGHT_PARAMETERS). A
 * client that sends no Sec-Fetch-Dest at all is refreshed, as before.
 */
function needsSessionRefresh(request: NextRequest): boolean {
  if (request.nextUrl.pathname.startsWith('/api/')) return false
  const dest = request.headers.get('sec-fetch-dest')
  if (dest !== null && dest !== 'document') return false
  return hasSessionCookie(request)
}

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
let warnedUnlocked = false

function isEdgeBypass(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  if (!isEdgeLockConfigured()) {
    // Off by design until the Cloudflare rule exists — but a production
    // deployment running without it is reachable around the WAF, and that
    // must be visible in the logs rather than silent. Once per instance.
    if (process.env.VERCEL_ENV === 'production' && !warnedUnlocked) {
      warnedUnlocked = true
      console.error(
        '[security] EDGE_ORIGIN_SECRET is not set: the origin lock is OFF and this deployment ' +
          'answers directly on *.vercel.app, bypassing Cloudflare (docs/security/phase-1-perimeter.md).',
      )
    }
    return false
  }
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

  // Refresh first when there is a session to refresh: the rotated auth
  // cookies have to ride along on whatever response we end up returning,
  // including redirects.
  const { response } = needsSessionRefresh(request)
    ? await updateSession(request)
    : { response: NextResponse.next() }

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
     * Widened from the admin-only matcher: Supabase tokens are refreshed on
     * page navigations (needsSessionRefresh decides which), not just under
     * /admin. Static assets and image optimiser requests are excluded — they
     * carry no session and running the middleware on them would be pure
     * latency.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|webmanifest)$).*)',
  ],
}
