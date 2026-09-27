import 'server-only'

import { DEFAULT_LOCALE, translate } from '@/lib/i18n'
import { localeParam } from '@/lib/locale-routing'
import type { Locale, LocalizedText, Product, StorefrontLocale } from '@/lib/types'

/**
 * Products as a LISTING needs them — a grid, a rail, a search result — rather
 * than as the product page does.
 *
 * Measured on a 150-product catalogue, a full Product serialises to ~5 KB, and
 * most of it is data no card shows: the description in five languages (37%),
 * variant ids and SKUs, the size chart, every gallery image. A listing keeps
 * what cards, filters and the smart search read (lib/search/match.ts,
 * lib/search/interpret.ts, lib/stylist/tagging.ts) and drops the rest:
 *
 *  - description: the one language being read, already resolved with the
 *    same fallback the client's localize() applies (translate()), so the
 *    grid's text filter matches exactly what it matched before
 *  - images: the cover and the hover shot
 *  - variants: size, colour and stock — not the row id or SKU, which only the
 *    product page (waitlist) and the admin use
 *  - sizeChart: product page only
 *
 * The result is still a `Product`: every field it drops is optional, and the
 * description is keyed by the locale that will read it.
 */

/** A card shows the cover and swaps to the second photo on hover. */
const CARD_IMAGES = 2

export function toListingProduct(p: Product, locale: Locale): Product {
  return {
    id: p.id,
    name: p.name,
    group: p.group,
    category: p.category,
    price: p.price,
    oldPrice: p.oldPrice,
    sizes: p.sizes,
    colors: p.colors,
    image: p.image,
    images: p.images?.slice(0, CARD_IMAGES),
    // Only this locale's key is present. No client code reads a description
    // by a fixed language; everything goes through localize(), which asks for
    // exactly this key first.
    description: { [locale]: translate(p.description, locale) } as LocalizedText,
    statuses: p.statuses,
    isNew: p.isNew,
    limited: p.limited,
    brand: p.brand,
    deliveryDays: p.deliveryDays,
    styleTags: p.styleTags,
    specs: p.specs,
    variants: p.variants?.map(({ size, color, stock, lowStockAt }) => ({ size, color, stock, lowStockAt })),
  }
}

export function toListing(products: Product[], locale: Locale): Product[] {
  return products.map((p) => toListingProduct(p, locale))
}

/**
 * How many products each department and each department/category holds,
 * keyed `group` and `group/category`. What the category sidebar shows, so a
 * page that lists one department can still count the others.
 */
export type ListingCounts = Record<string, number>

export function listingCounts(products: Product[]): ListingCounts {
  const counts: ListingCounts = {}
  for (const p of products) {
    counts[p.group] = (counts[p.group] ?? 0) + 1
    const key = `${p.group}/${p.category}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/**
 * The language a page is rendered in. The /it/… wrappers render the same page
 * components as the unprefixed routes and pass `params.locale`; the
 * unprefixed routes are the default language.
 */
export function pageLocale(params?: { locale?: string }): StorefrontLocale {
  return (params?.locale && localeParam(params.locale)) || DEFAULT_LOCALE
}

/** How many products the "you may also like" rail shows. */
const RELATED_COUNT = 8

/**
 * The product page's related rail: the same category first, then the rest of
 * the department. Falling back to the department matters on a thin catalogue,
 * where a category may hold only the product being viewed and the rail would
 * otherwise be empty.
 */
export function relatedProducts(all: Product[], product: Product, locale: Locale): Product[] {
  const sameCategory = all.filter((p) => p.id !== product.id && p.category === product.category)
  const sameGroup = all.filter(
    (p) => p.id !== product.id && p.group === product.group && p.category !== product.category,
  )
  return toListing([...sameCategory, ...sameGroup].slice(0, RELATED_COUNT), locale)
}
