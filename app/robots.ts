import type { MetadataRoute } from 'next'

/**
 * robots.txt, served at /robots.txt by the App Router.
 *
 * Indexing is open to every crawler, with a small disallow list. Those paths
 * are excluded not to hide them but because indexing them is actively bad:
 *
 *   /admin, /admin/login   the private console; a login form in search results
 *                          invites credential-stuffing traffic
 *   /auth/                 password-recovery screens are transactional and
 *                          meaningless out of context
 *   /order/                order pages contain a customer's name, address and
 *                          basket, gated only by a per-order token — a crawled
 *                          and cached order page is a privacy incident
 *   /success               3-D Secure return hop, no standalone content
 *   /checkout/success      thank-you page; renders one customer's order
 *   /api/                  JSON endpoints, never useful in an index
 *
 * NOTE: robots.txt controls crawling, not indexing. A disallowed URL can still
 * appear in results if something links to it. The order pages are additionally
 * protected by their lookup token, and anything genuinely sensitive should
 * carry a `noindex` header rather than rely on this file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/auth/', '/order/', '/success', '/checkout/success', '/api/'],
      },
    ],
    sitemap: 'https://luxe-vault.store/sitemap.xml',
    host: 'https://luxe-vault.store',
  }
}
