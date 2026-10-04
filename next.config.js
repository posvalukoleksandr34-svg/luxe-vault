const { siteCsp } = require('./config/csp')

// One UI dictionary per language (lib/ui-dict/*.json), resolved from
// lib/ui-strings.ts before anything is compiled — here rather than in an npm
// script so every way of running `next build` or `next dev` produces them.
// See scripts/ui-dictionaries.js.
require('./scripts/ui-dictionaries').generate()

/**
 * Content-Security-Policy: the site-wide, static policy (config/csp.js, which
 * explains every origin in it). /checkout and /admin are excluded from it —
 * middleware.ts serves them a STRICT, per-request nonce policy instead,
 * without 'unsafe-inline' for scripts.
 */
const contentSecurityPolicy = siteCsp()

/** The pages that get the strict nonce policy from middleware.ts instead. */
const NOT_STRICT_CSP_PAGES = '(?!checkout(?:/|$)|admin(?:/|$))'

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

  /**
   * Security headers, applied to every response. The rest are safe to apply
   * blindly to a whole site and are enforced by the browser on the customer's
   * behalf.
   */
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
        // Every page except the strict-policy ones (NOT_STRICT_CSP_PAGES).
        source: `/:path(${NOT_STRICT_CSP_PAGES}.*)`,
        headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }],
      },
      {
        source: '/:path*',
        headers: [
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
}

module.exports = nextConfig
