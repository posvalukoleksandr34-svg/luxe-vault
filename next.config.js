const isDev = process.env.NODE_ENV !== 'production'

/**
 * The Supabase project's own host, from NEXT_PUBLIC_SUPABASE_URL (set at build
 * time on Vercel). Anyone can create a *.supabase.co project, so the policies
 * below name THIS project rather than the whole domain: a wildcard would let
 * injected script send data to, or load images from, an attacker's project.
 * Falls back to the wildcard only when the variable is absent (a local build
 * without Supabase), where there is nothing to protect.
 */
const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').host || '*.supabase.co'
  } catch {
    return '*.supabase.co'
  }
})()

// One UI dictionary per language (lib/ui-dict/*.json), resolved from
// lib/ui-strings.ts before anything is compiled — here rather than in an npm
// script so every way of running `next build` or `next dev` produces them.
// See scripts/ui-dictionaries.js.
require('./scripts/ui-dictionaries').generate()

/**
 * Content-Security-Policy, one directive per key.
 *
 * Every origin here is one the BROWSER talks to. Geocoding (Photon, Google
 * Places), NOWPayments and Resend are called from our own API routes, so they
 * are deliberately absent — listing them would widen the policy for nothing.
 *
 * - Stripe: Stripe.js from js.stripe.com, the PaymentElement and 3-D Secure
 *   frames from js.stripe.com / hooks.stripe.com, card confirmation against
 *   api.stripe.com. This is the set Stripe documents for Elements.
 * - Supabase: auth and queries over HTTPS, realtime over WSS, product imagery
 *   from Storage — this project's host only (SUPABASE_HOST above).
 *   Supabase is kept OUT of script-src and style-src on purpose: anyone can
 *   create a *.supabase.co project and serve files from its public bucket, so
 *   allowing it there would let an attacker's own project supply code or CSS.
 * - images.unsplash.com: seed catalogue images, loaded directly (not through
 *   the optimiser) by the full-resolution zoom view. Drop with remotePatterns.
 *
 * KNOWN GAP: script-src carries 'unsafe-inline'. Next 13 emits inline
 * bootstrap scripts (the RSC payload), and the layout's motion boot script is
 * inline too. The only way to drop 'unsafe-inline' is a per-request nonce,
 * which a static header cannot carry — it has to be generated in middleware
 * and threaded into the document. Everything else is locked to named
 * origins, which is what stops injected markup loading an attacker's script,
 * frame or stylesheet, or sending data anywhere but Stripe and Supabase.
 *
 * style-src needs 'unsafe-inline' for React `style` attributes and the inline
 * styles Stripe.js puts on its own frames. In development only, 'unsafe-eval'
 * (React Refresh / eval source maps) and ws: (the HMR socket) are added.
 *
 * @type {Record<string, string[]>}
 */
const CSP_DIRECTIVES = {
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
    `https://${SUPABASE_HOST}`,
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
    `https://${SUPABASE_HOST}`,
    `wss://${SUPABASE_HOST}`,
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
  // Clickjacking. 'none' rather than 'self': nothing on this site is meant to
  // be framed, including by itself. Supersedes X-Frame-Options.
  'frame-ancestors': ["'none'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  // Any http:// subresource left in content (an old product image URL) is
  // fetched over HTTPS instead of being blocked as mixed content.
  ...(isDev ? {} : { 'upgrade-insecure-requests': [] }),
  // Violations are posted to app/api/csp-report and logged. `report-uri` for
  // Firefox and Safari; `report-to` (with the Reporting-Endpoints header
  // below) for Chromium, which prefers it when both are present.
  'report-uri': ['/api/csp-report'],
  'report-to': ['csp-endpoint'],
}

const contentSecurityPolicy = Object.entries(CSP_DIRECTIVES)
  .map(([directive, sources]) => [directive, ...sources].join(' '))
  .join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No `X-Powered-By: Next.js` — it only tells a scanner which advisories to try.
  poweredByHeader: false,
  // Lint runs in the build again. It was disabled, which meant nothing ever
  // failed on a lint error and the two warnings it had been hiding went
  // unnoticed for a long time — one of them a real stale-closure bug that
  // stamped new accounts with the wrong language.
  //
  // `next/core-web-vitals` reports accessibility and hooks problems as
  // WARNINGS, which do not fail a build; only genuine errors do. So this is a
  // safety net against regressions, not a tripwire that blocks deploys over
  // formatting.
  eslint: {
    ignoreDuringBuilds: false,
  },
  // Server Actions (actions/*.ts) are stable from Next 14 and need no flag.
  //
  // Loaded by Node at runtime instead of bundled by webpack. @google/genai
  // (the AI stylist's copy) pulls in `ws` for its Live API, and `ws` probes
  // for two OPTIONAL native add-ons — bufferutil and utf-8-validate — inside
  // a try/catch. Node handles that; webpack cannot, and printed a pair of
  // "Module not found" warnings on every compile of /api/stylist. Harmless,
  // but noise like that is how a real build warning gets scrolled past.
  // pdfkit (the admin's PDF invoices) finds its own files at runtime
  // relative to where it is installed; bundled by webpack, those paths point
  // nowhere and the first invoice fails with ENOENT. Left external it runs
  // from node_modules as published.
  serverExternalPackages: ['@google/genai', 'pdfkit'],
  images: {
    // Product and collection imagery lives in Supabase Storage, so the
    // optimiser has to be allowed to fetch from the project's public bucket.
    // Anything not listed here is refused rather than proxied, which is what
    // stops the endpoint being used as an open image proxy for the internet.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hifnrpgbxlzrpwxldjqc.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      // The department tiles' photographs (components/sections-grid.tsx),
      // and only Unsplash's photo paths — not anything else that host serves.
      { protocol: 'https', hostname: 'images.unsplash.com', pathname: '/photo-*' },
    ],
    // SVG is never optimised (it can carry script); this is the default,
    // stated so that nobody turns it on to make a logo "work".
    dangerouslyAllowSVG: false,
    // Widths actually used by the layout: the product grid is a 3-up at
    // 1180px, the detail gallery is a single column, and the cart/checkout
    // thumbnails are 56-96px. Trimming the default list means fewer cached
    // variants per image and fewer optimiser invocations.
    imageSizes: [64, 96, 128, 256, 384],
    deviceSizes: [640, 828, 1080, 1200, 1920],
    // WebP only. AVIF was the path of the optimiser's remote-code-execution
    // advisory (GHSA-2xp9-vwfh-vxw4, fixed by the upgrade to 15.5.26); it is
    // also several times slower to encode, and its saving over WebP on these
    // photographs is small. Re-add 'image/avif' only with a measured reason.
    formats: ['image/webp'],
    // A year. Object names carry a random id, so a replaced image is a new
    // URL and there is nothing to invalidate.
    minimumCacheTTL: 31536000,
  },

  /**
   * Security headers, applied to every response. The CSP is built above;
   * the rest are safe to apply blindly to a whole site and are enforced by
   * the browser on the customer's behalf.
   */
  /**
   * Short, stable addresses for links the shop hands out — newsletter buttons
   * above all (lib/newsletter/cta-links.ts). An email cannot be edited once it
   * is sent, so these point at wherever that content lives today, and can be
   * repointed later without breaking a single old campaign. Temporary (307)
   * for the same reason: nothing here is a canonical page.
   */
  async redirects() {
    return [
      { source: '/new-arrivals', destination: '/catalog?view=new', permanent: false },
      { source: '/sale', destination: '/catalog?view=sale', permanent: false },
      { source: '/about', destination: '/#about', permanent: false },
    ]
  },

  async headers() {
    return [
      {
        // Self-hosted fonts (public/fonts): cached for a year, like the hashed
        // files under /_next/static. A font is never edited in place — a
        // changed file gets a new name.
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // The service worker must never be served from an HTTP cache: a
        // stale sw.js would keep old caching rules alive after a deploy.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Reporting-Endpoints', value: 'csp-endpoint="/api/csp-report"' },
          // Legacy twin of frame-ancestors 'none', for browsers that predate it.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Isolates the window from pages it opens and that open it (no
          // window.opener tampering, no cross-window leaks). allow-popups keeps
          // payment-provider popups able to report back.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          // Stops a browser second-guessing a Content-Type, which is how a
          // user-uploaded file gets executed as script.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Send the full URL within the site, only the origin off-site — so
          // an order page's path never leaks to a third party in a referrer.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // This shop asks for none of these. Denying them means a compromised
          // script cannot silently start.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // Two years, subdomains included, preload-eligible. Vercel already
          // serves HTTPS only; this is what stops the first plaintext request
          // on a later visit.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
};

module.exports = nextConfig;
