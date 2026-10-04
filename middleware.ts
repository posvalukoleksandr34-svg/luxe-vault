import { NextRequest, NextResponse } from 'next/server'
import { strictCsp } from '@/config/csp'
import { MOTION_BOOT_SCRIPT } from '@/lib/motion-boot'
import { ADMIN_SESSION_COOKIE, verifySessionToken } from '@/lib/server/admin-auth'
import { edgeSessionState } from '@/lib/server/admin-session-edge'
import { cameThroughEdge, EDGE_SECRET_MIN_LENGTH, edgeLockState } from '@/lib/server/client-ip'
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
 * Origin lock. In production a request that did not come through Cloudflare
 * — no `x-edge-auth` header matching EDGE_ORIGIN_SECRET — is refused, so the
 * *.vercel.app address is not a way around the WAF and the edge rate limits
 * (docs/security/phase-1-perimeter.md).
 *
 * FAIL CLOSED: a production deployment WITHOUT the secret refuses everything
 * (503) instead of serving openly. The only way to run production unlocked is
 * the explicit, logged break-glass switch EDGE_ORIGIN_LOCK=off. Off in
 * development and for `next start` outside Vercel, so local work needs no
 * secret (lib/server/client-ip.ts, edgeLockState).
 */
let warnedLockState = false

function originLockRefusal(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl
  if (EDGE_LOCK_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null
  const state = edgeLockState()
  if (state === 'off') {
    if (process.env.VERCEL_ENV === 'production' && !warnedLockState) {
      warnedLockState = true
      console.error(
        '[security] EDGE_ORIGIN_LOCK=off: the origin lock is DISABLED and this deployment answers ' +
          'directly on *.vercel.app, bypassing Cloudflare. Remove the switch once EDGE_ORIGIN_SECRET is set.',
      )
    }
    return null
  }
  if (state === 'misconfigured') {
    if (!warnedLockState) {
      warnedLockState = true
      console.error(
        '[security] EDGE_ORIGIN_SECRET is not set in production: refusing all requests (fail closed). ' +
          'Set it (and the Cloudflare Transform Rule) — docs/security/phase-1-perimeter.md.',
      )
    }
    return new NextResponse('Service unavailable', { status: 503 })
  }
  if (!warnedLockState && (process.env.EDGE_ORIGIN_SECRET?.trim().length ?? 0) < EDGE_SECRET_MIN_LENGTH && process.env.VERCEL_ENV === 'production') {
    warnedLockState = true
    console.error(`[security] EDGE_ORIGIN_SECRET is shorter than ${EDGE_SECRET_MIN_LENGTH} characters: replace it with \`openssl rand -hex 32\`.`)
  }
  return cameThroughEdge(request.headers) ? null : new NextResponse('Forbidden', { status: 403 })
}

/**
 * Pages served with the STRICT Content-Security-Policy (config/csp.js): the
 * checkout, which hosts Stripe's payment frame, and the admin console. Every
 * other page keeps the static site-wide policy from next.config.js, which
 * excludes exactly these paths.
 */
function isStrictCspPage(pathname: string): boolean {
  return (
    pathname === '/checkout' ||
    pathname.startsWith('/checkout/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/')
  )
}

/** The root layout's one fixed inline script, allowed by hash. Computed once. */
let motionBootHash: Promise<string> | null = null
function inlineScriptHashes(): Promise<string[]> {
  motionBootHash ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(MOTION_BOOT_SCRIPT))
    .then((digest) => `sha256-${btoa(String.fromCharCode(...Array.from(new Uint8Array(digest))))}`)
  return motionBootHash.then((hash) => [hash])
}

/** A fresh nonce for this response: 16 random bytes, base64. */
function newNonce(): string {
  return btoa(String.fromCharCode(...Array.from(crypto.getRandomValues(new Uint8Array(16)))))
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

  const refused = originLockRefusal(request)
  if (refused) return refused
  // The image optimiser is matched only so the origin lock covers it (it
  // fetches remote images server-side — a cost and abuse vector around the
  // edge). Nothing else here applies to it.
  if (pathname.startsWith('/_next/image')) return NextResponse.next()

  // CSRF: a state-changing request a browser marks as cross-site is refused
  // before any handler, cookie refresh or session check runs (lib/server/csrf.ts).
  if (isCrossSiteWrite(request.method, pathname, request.headers)) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 })
  }

  // The strict policy for the checkout and the admin console. Next reads the
  // nonce from the REQUEST's Content-Security-Policy header while rendering
  // and puts it on every script it emits; the same policy goes out on the
  // response. Those pages render per request (their layouts are dynamic), so
  // each document gets its own nonce.
  let forwarded = request
  let csp: string | null = null
  if (isStrictCspPage(pathname)) {
    csp = strictCsp(newNonce(), await inlineScriptHashes())
    const headers = new Headers(request.headers)
    headers.set('content-security-policy', csp)
    forwarded = new NextRequest(request, { headers })
  }

  // Refresh first when there is a session to refresh: the rotated auth
  // cookies have to ride along on whatever response we end up returning,
  // including redirects.
  const { response } = needsSessionRefresh(forwarded)
    ? await updateSession(forwarded)
    : { response: csp ? NextResponse.next({ request: { headers: forwarded.headers } }) : NextResponse.next() }
  if (csp) response.headers.set('Content-Security-Policy', csp)

  // The admin console is a separate, self-contained auth system (password +
  // signed session cookie). It is intentionally NOT a Supabase user, so the
  // gate below is unchanged by the Supabase migration.
  if (!isAdminPath(pathname) || ADMIN_PUBLIC_PATHS.has(pathname)) {
    return response
  }

  // Signed, unexpired — and not signed out since (admin-session-edge.ts).
  const session = await verifySessionToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)
  if (session && (await edgeSessionState(session.nonce)) !== 'refused') {
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
    // The image optimiser, for the origin lock only (see middleware()).
    '/_next/image',
  ],
}
