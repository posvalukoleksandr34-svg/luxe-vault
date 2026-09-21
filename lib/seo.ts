import type { Metadata } from 'next'

import { SUPPORT_EMAIL, TELEGRAM_ADMIN } from '@/lib/data'
import { DEFAULT_LOCALE, UI, translate, type UIKey } from '@/lib/i18n'
import {
  INDEXED_LOCALES,
  OG_LOCALE,
  alternatesFor,
  localizedPath,
} from '@/lib/locale-routing'
import { primaryText } from '@/lib/localized-text'
import type { Product, StorefrontLocale } from '@/lib/types'

/**
 * Everything a search engine is told about who publishes this shop.
 *
 * Three files used to declare the origin for themselves — the root layout, the
 * product page, robots.ts and sitemap.ts — which is three chances for a domain
 * change to leave one of them pointing somewhere else. A canonical that
 * disagrees with the sitemap is the kind of defect that costs weeks: Google
 * takes the disagreement as a signal that neither URL is authoritative.
 *
 * NOT lib/site-url.ts. That resolves per environment, on purpose, so an auth
 * email from a preview deployment returns to that preview. Canonicals, the
 * sitemap and structured data must name the PRODUCTION origin from every
 * environment — a preview build that advertises its own hostname to a crawler
 * is asking to be indexed as a duplicate of the real shop.
 */
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'https://luxe-vault.store').replace(/\/$/, '')

export const SITE_NAME = 'LUXE VAULT'
export const BRAND_NAME = 'Luxe Vault'

/** Stable @ids. A graph whose nodes reference each other by @id is read as one
 *  entity across pages, which is what builds a brand's knowledge panel rather
 *  than a different anonymous Organization on every URL. */
export const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`
export const WEBSITE_ID = `${SITE_ORIGIN}/#website`
export const BRAND_ID = `${SITE_ORIGIN}/#brand`

/**
 * The publisher, the brand and the site, as one graph.
 *
 * Emitted once from the root layout, so every page carries it and every page's
 * own schema (Product, BreadcrumbList, ItemList) can point at these @ids
 * instead of repeating them.
 *
 * `sameAs` is the shop's OWN profiles, and nothing else. It is how a search
 * engine confirms that the Telegram account and this domain are one business;
 * padding it with unrelated links is a well-known way to lose the association
 * altogether.
 *
 * What is deliberately absent: `aggregateRating` (site-wide review stars are a
 * structured-data violation unless they are about the Organization itself and
 * collected independently), a postal `address` beyond the country (this is a
 * private sale with no shopfront, and inventing a street address to win a
 * LocalBusiness panel is a misrepresentation), and `potentialAction` /
 * SearchAction — the shop's search is a client-side overlay with no results
 * URL, so there is nothing for a sitelinks search box to submit to.
 */
export function siteJsonLd(description: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORGANIZATION_ID,
        name: BRAND_NAME,
        alternateName: SITE_NAME,
        url: SITE_ORIGIN,
        description,
        logo: {
          '@type': 'ImageObject',
          '@id': `${SITE_ORIGIN}/#logo`,
          url: `${SITE_ORIGIN}/icons/icon-512.png`,
          width: 512,
          height: 512,
          caption: BRAND_NAME,
        },
        image: { '@id': `${SITE_ORIGIN}/#logo` },
        email: SUPPORT_EMAIL,
        // Switzerland, which is where the goods ship from and the only part of
        // an address this seller actually has.
        address: { '@type': 'PostalAddress', addressCountry: 'CH' },
        areaServed: 'Worldwide',
        sameAs: [`https://t.me/${TELEGRAM_ADMIN.replace('@', '')}`],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer service',
          email: SUPPORT_EMAIL,
          // What the STOREFRONT answers in. It used to list Russian first,
          // which is now the admin console's language and no customer's.
          availableLanguage: ['English', 'Italian', 'German', 'French'],
        },
      },
      {
        '@type': 'Brand',
        '@id': BRAND_ID,
        name: BRAND_NAME,
        url: SITE_ORIGIN,
        logo: `${SITE_ORIGIN}/icons/icon-512.png`,
      },
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: SITE_ORIGIN,
        name: SITE_NAME,
        description,
        publisher: { '@id': ORGANIZATION_ID },
        inLanguage: DEFAULT_LOCALE,
      },
    ],
  }
}

/**
 * A listing page's products, as an ItemList.
 *
 * The product pages already carry full Product schema; this tells a crawler
 * what a CATEGORY page holds and in what order, which is what lets the
 * listing itself rank for a category query rather than only its members.
 *
 * Each entry carries a URL and the essentials, not a full Product graph.
 * Repeating price and availability here would duplicate the product page's own
 * claims, and two copies that can drift is worse than one that cannot: the
 * item's `url` is where the authoritative version lives.
 *
 * Capped, because an ItemList is a summary. A category with four hundred
 * pieces does not need four hundred nodes in the head of every page to be
 * understood, and the sitemap already submits all of them individually.
 */
const ITEM_LIST_MAX = 60

export function itemListJsonLd(products: Product[], path: string, name: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${SITE_ORIGIN}${path}#products`,
    name,
    numberOfItems: products.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: products.slice(0, ITEM_LIST_MAX).map((product, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_ORIGIN}/product/${encodeURIComponent(product.id)}`,
      name: primaryText(product.name, product.id),
    })),
  }
}

/**
 * A storefront page's metadata, in one language.
 *
 * Server components cannot call the store's `t()` — it is a client hook — so
 * the copy is read straight from the dictionary with `translate`, which is
 * pure and has no provider. That is also what lets this run during static
 * generation, so a localised page stays prerendered rather than becoming a
 * per-request render.
 *
 * It always emits `alternates`: the canonical for this language and the
 * hreflang set for all of them. Emitting one without the other is the
 * classic way to get three of four languages dropped as duplicates.
 */
export function pageMetadata(options: {
  /** The bare, unprefixed path — the route's own name. */
  path: string
  locale: StorefrontLocale
  /** Read from the dictionary; or pass ready-made strings for a page whose
   *  title comes from the catalogue (a product, a category). */
  title?: string
  description?: string
  titleKey?: UIKey
  descriptionKey?: UIKey
  /**
   * A page that must not be indexed. It still gets a canonical in its own
   * language — links to it should not lose the prefix — but no hreflang set:
   * pairing four URLs as translations is a request to index them, and asking
   * for that on a page marked noindex is a contradiction a crawler resolves
   * by trusting neither.
   */
  noindex?: boolean
}): Metadata {
  const { path, locale } = options
  const title = options.title ?? (options.titleKey ? translate(UI[options.titleKey], locale) : undefined)
  const description =
    options.description ?? (options.descriptionKey ? translate(UI[options.descriptionKey], locale) : undefined)

  const { canonical, languages } = alternatesFor(path, locale)

  return {
    title,
    description,
    robots: options.noindex ? { index: false, follow: true } : undefined,
    alternates: options.noindex ? { canonical } : { canonical, languages },
    openGraph: {
      type: 'website',
      url: `${SITE_ORIGIN}${localizedPath(path, locale)}`,
      siteName: SITE_NAME,
      title: title ? `${title} \u2014 ${SITE_NAME}` : undefined,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: INDEXED_LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
    },
    // Without these the root layout's site-wide card wins, and every page in
    // every language shares one title on X and in the messengers that read
    // these rather than og:*.
    twitter: {
      card: 'summary_large_image',
      title: title ? `${title} — ${SITE_NAME}` : undefined,
      description,
    },
  }
}
