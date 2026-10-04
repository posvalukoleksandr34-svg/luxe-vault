/**
 * Content-Security-Policy — one table, two policies.
 *
 * `next.config.js` serves the SITE-WIDE policy as a static header on every
 * page. The storefront's pages are prerendered, so they cannot carry a
 * per-request nonce, and script-src keeps 'unsafe-inline' for Next's inline
 * bootstrap scripts. Everything else is locked to named origins.
 *
 * `middleware.ts` serves the STRICT policy on the pages that matter most —
 * checkout (the Stripe payment frame) and the admin console. Those render per
 * request, so script-src there drops 'unsafe-inline' for a fresh nonce that
 * Next puts on its own scripts, plus the hashes of the few fixed inline
 * scripts in the root layout. An injected <script> without the nonce does not
 * run there.
 *
 * Plain CommonJS so both can use it: next.config.js with require(), the Edge
 * middleware with import.
 *
 * Every origin here is one the BROWSER talks to. Geocoding (Photon, Google
 * Places), NOWPayments and Resend are called from our own API routes, so they
 * are deliberately absent — listing them would widen the policy for nothing.
 *
 * - Stripe: Stripe.js from js.stripe.com, the PaymentElement and 3-D Secure
 *   frames from js.stripe.com / hooks.stripe.com, card confirmation against
 *   api.stripe.com. This is the set Stripe documents for Elements.
 * - Supabase: auth and queries over HTTPS, realtime over WSS, product imagery
 *   from Storage — this project's host only (supabaseHost below). Kept OUT of
 *   script-src and style-src: anyone can create a *.supabase.co project and
 *   serve files from its public bucket.
 * - images.unsplash.com: the department tiles' photographs.
 *
 * style-src keeps 'unsafe-inline' in both policies: React `style` attributes
 * and the inline styles Stripe.js puts on its own frames need it, and a nonce
 * in style-src would switch it off. In development only, 'unsafe-eval' (React
 * Refresh) and ws: (the HMR socket) are added.
 */

const isDev = process.env.NODE_ENV !== 'production'

/**
 * The Supabase project's own host, from NEXT_PUBLIC_SUPABASE_URL (inlined at
 * build time). A wildcard would let injected script send data to, or load
 * images from, an attacker's project. Falls back to the wildcard only when
 * the variable is absent (a local build without Supabase).
 */
function supabaseHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').host || '*.supabase.co'
  } catch {
    return '*.supabase.co'
  }
}

/** @returns {Record<string, string[]>} */
function cspDirectives() {
  const host = supabaseHost()
  return {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      'https://js.stripe.com',
      'https://*.js.stripe.com',
      // GA4 and the Meta Pixel, injected only after consent
      // (lib/analytics-vendors.ts).
      'https://www.googletagmanager.com',
      'https://connect.facebook.net',
      // Cloudflare Turnstile's loader (components/turnstile-field.tsx).
      'https://challenges.cloudflare.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
    'img-src': [
      "'self'",
      // The product placeholder SVG and the crypto-payment QR code.
      'data:',
      `https://${host}`,
      'https://*.stripe.com',
      'https://images.unsplash.com',
      // Measurement beacons sent as images by GA4 and the Meta Pixel.
      'https://www.google-analytics.com',
      'https://*.google-analytics.com',
      'https://www.googletagmanager.com',
      'https://www.facebook.com',
    ],
    // Both font families are self-hosted under /fonts (see app/globals.css).
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      `https://${host}`,
      `wss://${host}`,
      'https://api.stripe.com',
      // GA4 collection endpoints and the Meta Pixel's.
      'https://www.google-analytics.com',
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
      'https://www.googletagmanager.com',
      'https://www.facebook.com',
      'https://connect.facebook.net',
      // The widget posts its challenge results back to Cloudflare.
      'https://challenges.cloudflare.com',
      ...(isDev ? ['ws:'] : []),
    ],
    // Turnstile renders its challenge in an iframe of its own.
    'frame-src': [
      'https://js.stripe.com',
      'https://*.js.stripe.com',
      'https://hooks.stripe.com',
      'https://challenges.cloudflare.com',
    ],
    'object-src': ["'none'"],
    // Stops injected <base href> re-pointing every relative URL on the page.
    'base-uri': ["'self'"],
    // No form on the site posts off-origin; Stripe and Supabase redirects are
    // navigations, which this does not restrict.
    'form-action': ["'self'"],
    // Clickjacking. 'none' rather than 'self': nothing on this site is meant
    // to be framed, including by itself. Supersedes X-Frame-Options.
    'frame-ancestors': ["'none'"],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
    // Any http:// subresource left in content is fetched over HTTPS instead of
    // being blocked as mixed content.
    ...(isDev ? {} : { 'upgrade-insecure-requests': [] }),
    // Violations are posted to app/api/csp-report and logged. `report-uri` for
    // Firefox and Safari; `report-to` (with the Reporting-Endpoints header in
    // next.config.js) for Chromium.
    'report-uri': ['/api/csp-report'],
    'report-to': ['csp-endpoint'],
  }
}

/** @param {Record<string, string[]>} directives */
function serializeCsp(directives) {
  return Object.entries(directives)
    .map(([directive, sources]) => [directive, ...sources].join(' '))
    .join('; ')
}

/** The site-wide, static policy. */
function siteCsp() {
  return serializeCsp(cspDirectives())
}

/**
 * The strict policy: no 'unsafe-inline' for scripts — only this request's
 * nonce and the listed hashes ('sha256-…' strings) run inline.
 *
 * @param {string} nonce
 * @param {string[]} [hashes]
 */
function strictCsp(nonce, hashes = []) {
  const directives = cspDirectives()
  directives['script-src'] = directives['script-src']
    .filter((source) => source !== "'unsafe-inline'")
    .concat(`'nonce-${nonce}'`, hashes.map((h) => `'${h}'`))
  return serializeCsp(directives)
}

module.exports = { cspDirectives, serializeCsp, siteCsp, strictCsp, supabaseHost }
