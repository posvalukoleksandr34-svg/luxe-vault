import type { MetadataRoute } from 'next'
import { listProductSlugs } from '@/lib/server/catalog-store'

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
 * Products now have real routes at /product/[slug], so every one is listed
 * below. The slug is `products.slug`, surfaced as `Product.id`.
 *
 * Read from the database at request time rather than baked in at build: a
 * product added through the admin panel appears in the sitemap without a
 * redeploy, which is the whole reason the catalogue lives in Postgres.
 */

/**
 * Deliberately excluded, and also disallowed in robots.ts:
 *   /admin, /admin/login        private console
 *   /auth/*                     transactional, no standalone value
 *   /order/[id]                 private order data behind a per-order token
 *   /success                    post-payment landing, nothing to index
 */

/** The legal documents' stated effective date, which is their real lastModified. */
const LEGAL_UPDATED = new Date('2026-09-06T00:00:00.000Z')

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Build time. The storefront's content changes when the catalogue is
  // redeployed, so this is an honest signal rather than a hardcoded date that
  // would go stale and teach Google to ignore the field.
  const now = new Date()

  void SECTIONS_ARE_ANCHORS

  // A failed catalogue read must not take the whole sitemap down: serving the
  // static pages is strictly better than serving Google a 500, which it treats
  // as "could not fetch" and retries with backoff.
  let products: { slug: string; updatedAt: Date }[] = []
  try {
    products = await listProductSlugs()
  } catch (error) {
    console.error('[sitemap] product slugs unavailable:', error)
  }

  return [
    {
      url: `${BASE}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    // Product pages rank for the queries that actually convert, so they carry
    // the highest priority after the homepage.
    ...products.map((p) => ({
      url: `${BASE}/product/${encodeURIComponent(p.slug)}`,
      lastModified: p.updatedAt,
      changeFrequency: 'daily' as const,
      priority: 0.9,
    })),
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
