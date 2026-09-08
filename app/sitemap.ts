import type { MetadataRoute } from 'next'
import { listProductSlugs } from '@/lib/server/catalog-store'
import { readTaxonomy } from '@/lib/server/taxonomy'

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
 * The catalogue is no longer a single page: every collection and subcategory
 * has a real route at /category/[collection][/subcategory], and those are
 * listed below. They are the pages that can rank for a category query at all —
 * "#shop" never could, because Google treats `/#shop` and `/` as one URL.
 *
 * What remains anchors-only is the editorial content: #about and #reviews are
 * still sections of `/`, and /about, /reviews, /contacts, /new-arrivals and
 * /sale return 404. Anchors are deliberately NOT listed — submitting them
 * would submit the homepage several times over rather than gain entries.
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

  // Category URLs, from the same taxonomy the routes themselves resolve, so
  // the sitemap cannot list a collection the route would 404. EMPTY ONES ARE
  // SKIPPED: the route renders them (an existing link must not break the day
  // stock runs out), but submitting a page with no products to Google is
  // exactly the "crawled — currently not indexed" outcome the file's opening
  // note is about.
  const categoryUrls: MetadataRoute.Sitemap = []
  try {
    const { tree } = await readTaxonomy()
    for (const node of tree) {
      if (node.count === 0) continue
      categoryUrls.push({
        url: `${BASE}/category/${encodeURIComponent(node.slug)}`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.8,
      })
      for (const category of node.categories) {
        if (category.count === 0) continue
        categoryUrls.push({
          url: `${BASE}/category/${encodeURIComponent(node.slug)}/${encodeURIComponent(category.slug)}`,
          lastModified: now,
          changeFrequency: 'daily',
          priority: 0.7,
        })
      }
    }
  } catch (error) {
    console.error('[sitemap] taxonomy unavailable:', error)
  }

  return [
    {
      url: `${BASE}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    // Category pages sit between the homepage and the products: broader than a
    // single item, narrower than the shop.
    ...categoryUrls,
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
