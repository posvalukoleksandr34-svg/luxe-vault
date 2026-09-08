/** @type {import('next').NextConfig} */
const nextConfig = {
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
      // Seed catalogue images. Safe to drop once no product references them.
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    // Widths actually used by the layout: the product grid is a 3-up at
    // 1180px, the detail gallery is a single column, and the cart/checkout
    // thumbnails are 56-96px. Trimming the default list means fewer cached
    // variants per image and fewer optimiser invocations.
    imageSizes: [64, 96, 128, 256, 384],
    deviceSizes: [640, 828, 1080, 1200, 1920],
    formats: ['image/avif', 'image/webp'],
    // A year. Object names carry a random id, so a replaced image is a new
    // URL and there is nothing to invalidate.
    minimumCacheTTL: 31536000,
  },

  /**
   * Security headers.
   *
   * There were none. These are the ones that are safe to apply blindly to a
   * whole site and that a browser enforces on the customer's behalf.
   *
   * NOT INCLUDED: a full Content-Security-Policy with script-src. This site
   * embeds Stripe.js, which injects its own frames and inline styles, and Next
   * emits inline bootstrap scripts — so a strict policy needs per-response
   * nonces threaded through the document. Getting that wrong does not fail a
   * build; it silently breaks the card form for real customers. It is worth
   * doing, and worth doing as its own change with the payment flow re-tested
   * end to end, rather than bundled into a headers block.
   *
   * `frame-ancestors` IS included, because it is the one CSP directive with no
   * such risk and it supersedes X-Frame-Options.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Clickjacking. 'none' rather than 'self': nothing on this site is
          // meant to be framed, including by itself.
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'",
          },
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
