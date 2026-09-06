import type { MetadataRoute } from 'next'

/**
 * XML sitemap, served at /sitemap.xml by the App Router.
 *
 * ONLY URLs THAT ACTUALLY RESOLVE ARE LISTED. A sitemap is a set of claims to
 * Google that these pages exist and are worth crawling; listing 404s wastes
 * crawl budget and is reported in Search Console as "Submitted URL not found",
 * which is a worse position than having no sitemap at all.
 *
 * That is why several conventional storefront URLs are absent — see
 * SECTIONS_ARE_ANCHORS and PRODUCTS_HAVE_NO_ROUTES below. Both are one-line
 * additions here the moment the corresponding routes exist.
 */

const BASE = 'https://luxe-vault.store'

/**
 * The storefront is a single page. "Collections", "Shop", "About" and
 * "Reviews" are anchor sections on `/` (#collections, #shop, #about,
 * #reviews), not routes — /collections, /catalog, /new-arrivals, /sale,
 * /about, /reviews and /contacts all return 404.
 *
 * Anchors are deliberately NOT listed: Google treats `/#shop` and `/` as the
 * same URL, so adding them would submit the homepage five times rather than
 * gaining five entries. Splitting these into real routes is a prerequisite for
 * ranking them separately.
 */
const SECTIONS_ARE_ANCHORS = true

/**
 * Products open in a client-side modal and `Product` carries no slug, so there
 * is no per-product URL to submit. Giving each product a route (and a `slug`)
 * is the single highest-value SEO change available to this site — product
 * pages are what rank for "<brand> <item>" queries.
 */
const PRODUCTS_HAVE_NO_ROUTES = true

/**
 * Deliberately excluded, and also disallowed in robots.ts:
 *   /admin, /admin/login        private console
 *   /auth/*                     transactional, no standalone value
 *   /order/[id]                 private order data behind a per-order token
 *   /success                    post-payment landing, nothing to index
 */

/** The legal documents' stated effective date, which is their real lastModified. */
const LEGAL_UPDATED = new Date('2026-09-06T00:00:00.000Z')

export default function sitemap(): MetadataRoute.Sitemap {
  // Build time. The storefront's content changes when the catalogue is
  // redeployed, so this is an honest signal rather than a hardcoded date that
  // would go stale and teach Google to ignore the field.
  const now = new Date()

  void SECTIONS_ARE_ANCHORS
  void PRODUCTS_HAVE_NO_ROUTES

  return [
    {
      url: `${BASE}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE}/legal/terms`,
      lastModified: LEGAL_UPDATED,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${BASE}/legal/privacy`,
      lastModified: LEGAL_UPDATED,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${BASE}/legal/refunds`,
      lastModified: LEGAL_UPDATED,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]
}
