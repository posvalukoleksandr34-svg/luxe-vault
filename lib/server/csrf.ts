// Cross-site request forgery guard, run in middleware.ts (Edge runtime — no
// Node APIs here).
//
// Session cookies are SameSite=Lax, which already keeps them off cross-site
// POSTs in current browsers. This is the second layer, and the one that does
// not depend on cookie attributes or browser defaults: a state-changing request
// that a browser marks as coming from another site is refused before any
// handler runs.
//
// Only what a BROWSER says is judged. Browsers attach `Sec-Fetch-Site` and
// `Origin` to every cross-origin POST/PUT/PATCH/DELETE and page script cannot
// forge either. Server-to-server callers (Stripe, NOWPayments, a mail
// provider's one-click unsubscribe, the cron scheduler) send neither and pass —
// they are authenticated by signature, token or secret in their own handlers.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Endpoints that are called cross-site by design. Webhooks authenticate with a
 * provider signature; CSP reports are posted by the browser on the page's
 * behalf and carry no authority.
 */
const CSRF_EXEMPT = new Set([
  '/api/payments/stripe/webhook',
  '/api/payments/crypto/webhook',
  '/api/csp-report',
])

function requestHost(headers: Headers): string | null {
  // The platform proxy's view of the host wins: behind Vercel/Netlify the raw
  // Host header can be an internal name.
  return headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host')
}

/** True when a state-changing request plainly comes from another site. */
export function isCrossSiteWrite(method: string, pathname: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false
  if (CSRF_EXEMPT.has(pathname)) return false

  const fetchSite = headers.get('sec-fetch-site')
  if (fetchSite === 'cross-site') return true
  // 'same-origin' and 'none' (typed URL, bookmark) are first-party.
  // 'same-site' is ANOTHER host under the same registrable domain — any
  // subdomain. Nothing on this site posts across hosts, and a subdomain that
  // is ever taken over (a dangling DNS record) must not be able to write
  // here, so it passes only when its Origin is this very host.
  if (fetchSite === 'same-site') return !sameHost(headers)
  if (fetchSite) return false

  // Older browsers without Fetch Metadata: fall back to Origin.
  const origin = headers.get('origin')
  if (!origin || origin === 'null') return origin === 'null'
  return !sameHost(headers)
}

/** True when the request's Origin names the host it was sent to. */
function sameHost(headers: Headers): boolean {
  const origin = headers.get('origin')
  const host = requestHost(headers)
  if (!origin || origin === 'null' || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
