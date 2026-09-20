import type { MetadataRoute } from 'next'

import { DEFAULT_LOCALE } from '@/lib/i18n'
import { INDEXED_LOCALES, hasLocalizedRoute, localizedPath } from '@/lib/locale-routing'
import { SITE_ORIGIN } from '@/lib/seo'
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

const BASE = SITE_ORIGIN

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
 *   /checkout, /account         noindex (their segment layouts): a basket and
 *                               a personal account are not landing pages
 */

/** The legal documents' stated effective date, which is their real lastModified. */
const LEGAL_UPDATED = new Date('2026-09-06T00:00:00.000Z')

/**
 * One entry per language for a storefront path, each declaring the others as
 * its alternates.
 *
 * Submitting only the default language would leave the other three to be found
 * by luck. What pairs them as translations is the `hreflang` set in each
 * page's own <head> (lib/locale-routing.ts) — NOT anything here: Next 13.5
 * accepts `alternates` on a sitemap entry and emits nothing for it, no
 * xmlns:xhtml and no <xhtml:link>, so writing them here would look like a
 * guarantee while delivering nothing. Per-page hreflang is authoritative for
 * Google either way; revisit this if the sitemap route ever gains support.
 *
 * Paths here are BARE — `/catalog`, not `/it/catalog`. The prefix is this
 * function's business.
 */
function localized(
  path: string,
  entry: { lastModified: Date; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number },
): MetadataRoute.Sitemap {
  // Only the paths that actually have a localised route. Everything else is
  // still served — in the default language, at its bare URL — and is listed
  // once, which is the truth about it.
  const locales = hasLocalizedRoute(path) ? INDEXED_LOCALES : [DEFAULT_LOCALE]
  return locales.map((code) => ({
    url: `${BASE}${localizedPath(path, code)}`,
    ...entry,
  }))
}

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
      categoryUrls.push(
        ...localized(`/category/${encodeURIComponent(node.slug)}`, {
          lastModified: now,
          changeFrequency: 'daily',
          priority: 0.8,
        }),
      )
      for (const category of node.categories) {
        if (category.count === 0) continue
        categoryUrls.push(
          ...localized(
            `/category/${encodeURIComponent(node.slug)}/${encodeURIComponent(category.slug)}`,
            { lastModified: now, changeFrequency: 'daily', priority: 0.7 },
          ),
        )
      }
    }
  } catch (error) {
    console.error('[sitemap] taxonomy unavailable:', error)
  }

  return [
    ...localized('/', { lastModified: now, changeFrequency: 'daily', priority: 1.0 }),
    // The catalogue's own page. It became a real route when the homepage
    // stopped carrying a grid, and was missing here — an indexable page with
    // its own canonical that Google was never told about.
    ...localized('/catalog', { lastModified: now, changeFrequency: 'daily', priority: 0.9 }),
    // Category pages sit between the homepage and the products: broader than a
    // single item, narrower than the shop.
    ...categoryUrls,
    // Help & contact: how to reach the team, and the newsletter.
    ...localized('/contact', { lastModified: now, changeFrequency: 'monthly', priority: 0.4 }),
    // The AI stylist: a standing landing page with its own canonical.
    ...localized('/stylist', { lastModified: now, changeFrequency: 'weekly', priority: 0.6 }),
    // Product pages rank for the queries that actually convert, so they carry
    // the highest priority after the homepage.
    ...products.flatMap((p) =>
      localized(`/product/${encodeURIComponent(p.slug)}`, {
        lastModified: p.updatedAt,
        changeFrequency: 'daily',
        priority: 0.9,
      }),
    ),
    ...localized('/legal/terms', { lastModified: LEGAL_UPDATED, changeFrequency: 'monthly', priority: 0.3 }),
    ...localized('/legal/privacy', { lastModified: LEGAL_UPDATED, changeFrequency: 'monthly', priority: 0.3 }),
    ...localized('/legal/refunds', { lastModified: LEGAL_UPDATED, changeFrequency: 'monthly', priority: 0.3 }),
  ]
}
