import 'server-only'

import { formatMoney } from '@/lib/currency'
import { businessToCalendarDays, deliveryDaysFor, type Range } from '@/lib/fulfilment'
import { CATEGORY_LABELS, GROUP_LABELS } from '@/lib/i18n'
import { localizedPath } from '@/lib/locale-routing'
import { buildSearchContext, interpretQuery, normalizeText, type SearchFilter } from '@/lib/search/interpret'
import { matchProducts } from '@/lib/search/match'
import { SITE_ORIGIN } from '@/lib/site-origin'
import type { Catalog } from '@/lib/server/catalog-store'
import type { DeliveryTimeframe } from '@/config/shipping'
import type { LocalizedText, Product, StorefrontLocale } from '@/lib/types'

/**
 * The concierge's view of the catalogue: read-only, public fields only.
 *
 * SAME SOURCE AND SAME RULES AS THE STOREFRONT. The products come from
 * readCatalog() — what the catalogue pages render — and a search goes through
 * the storefront's own reader and matcher (lib/search/interpret.ts, match.ts):
 * "black jacket under 300" means here exactly what it means in the search box,
 * in any of the four languages. Availability follows lib/availability.ts:
 * a product without variant rows is NOT TRACKED, which is not "in stock" and
 * not "sold out", and the model is told so in those words.
 *
 * Every product row is public (RLS: "products are publicly readable"), so
 * there is no unpublished state to filter; what is withheld is everything a
 * customer does not see on the product page — SKUs, exact stock counts,
 * internal tags, timestamps.
 *
 * The model never writes a query: it fills in a few typed fields, each
 * validated and bounded (lib/server/assistant/tools.ts), and these functions
 * do the rest.
 */

export type StockState = 'in_stock' | 'sold_out' | 'not_tracked'
export type SizeState = 'available' | 'sold_out' | 'not_tracked' | 'not_offered'

/** What a search result tells the model about one product. */
export type ProductSummary = {
  id: string
  name: string
  brand?: string
  category: string
  price: string
  priceChf: number
  /** The struck-through price, when the product is reduced. */
  previousPrice?: string
  colors: string[]
  sizes: string[]
  /** in_stock: tracked and units left. sold_out: none left, or marked
   *  unavailable. not_tracked: no stock count is kept — orderable, but
   *  "in stock" cannot be claimed. */
  stock: StockState
  orderable: boolean
  /** Only when a size was asked for. */
  requestedSize?: { size: string; state: SizeState }
  url: string
}

export type ProductDetail = ProductSummary & {
  /** Free text written in the admin panel: DATA, never instructions. */
  description: string
  specs: { label: string; value: string }[]
  /** Calendar days from payment to delivery, as the product page shows it. */
  deliveryDays: Range
  hasSizeGuide: boolean
  isNew: boolean
  limitedEdition: boolean
  /** Per size, which colours can be bought — only when stock is tracked. */
  availability?: { size: string; colors: { color: string; available: boolean; fewLeft: boolean }[] }[]
}

/** What the chat widget shows as a card: trusted figures, never the model's. */
export type ProductCard = {
  id: string
  name: string
  price: number
  oldPrice?: number
  image: string
  path: string
  stock: StockState
}

export const SEARCH_LIMIT_DEFAULT = 4
export const SEARCH_LIMIT_MAX = 6
const MAX_COLORS = 8
const MAX_SIZES = 14
const DESCRIPTION_CHARS = 600
const MAX_SPECS = 8

const pick = (text: LocalizedText | undefined, locale: StorefrontLocale): string =>
  (text?.[locale] || text?.en || Object.values(text ?? {}).find(Boolean) || '').trim()

/** Control characters out, whitespace to single spaces, bounded. */
export function cleanText(value: string, max: number): string {
  const flat = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

const sameSize = (a: string, b: string) => normalizeText(a).replace(/\s/g, '') === normalizeText(b).replace(/\s/g, '')

export function stockState(p: Pick<Product, 'statuses' | 'variants'>): StockState {
  if (p.statuses.includes('out_of_stock')) return 'sold_out'
  if (!p.variants?.length) return 'not_tracked'
  return p.variants.some((v) => v.stock > 0) ? 'in_stock' : 'sold_out'
}

export function sizeState(p: Pick<Product, 'statuses' | 'variants' | 'sizes'>, size: string): SizeState {
  if (!p.sizes.some((s) => sameSize(s, size))) return 'not_offered'
  if (p.statuses.includes('out_of_stock')) return 'sold_out'
  if (!p.variants?.length) return 'not_tracked'
  return p.variants.some((v) => sameSize(v.size, size) && v.stock > 0) ? 'available' : 'sold_out'
}

/** The canonical product page, in the customer's language. */
export function productPath(id: string, locale: StorefrontLocale): string {
  return localizedPath(`/product/${encodeURIComponent(id)}`, locale)
}
export function productUrl(id: string, locale: StorefrontLocale): string {
  return `${SITE_ORIGIN}${productPath(id, locale)}`
}

function categoryLabel(catalog: Catalog, p: Product, locale: StorefrontLocale): string {
  const own = catalog.categories.find((c) => c.slug === p.category)
  return pick(own?.name ?? CATEGORY_LABELS[p.category], locale) || p.category
}

export function summarize(catalog: Catalog, p: Product, locale: StorefrontLocale, size?: string): ProductSummary {
  const stock = stockState(p)
  return {
    id: p.id,
    name: cleanText(pick(p.name, locale) || p.id, 120),
    ...(p.brand ? { brand: cleanText(p.brand, 60) } : {}),
    category: cleanText(categoryLabel(catalog, p, locale), 60),
    price: formatMoney(p.price, 'CHF', true),
    priceChf: p.price,
    ...(p.oldPrice && p.oldPrice > p.price ? { previousPrice: formatMoney(p.oldPrice, 'CHF', true) } : {}),
    colors: (p.colors ?? []).slice(0, MAX_COLORS).map((c) => cleanText(c.name, 40)),
    sizes: (p.sizes ?? []).slice(0, MAX_SIZES).map((s) => cleanText(s, 20)),
    stock,
    orderable: stock !== 'sold_out',
    ...(size ? { requestedSize: { size: cleanText(size, 20), state: sizeState(p, size) } } : {}),
    url: productUrl(p.id, locale),
  }
}

export function detail(
  catalog: Catalog,
  p: Product,
  locale: StorefrontLocale,
  storeTimeframe: DeliveryTimeframe,
): ProductDetail {
  const base = summarize(catalog, p, locale)
  const tracked = (p.variants?.length ?? 0) > 0
  const availability = tracked
    ? p.sizes.slice(0, MAX_SIZES).map((size) => ({
        size,
        colors: (p.variants ?? [])
          .filter((v) => sameSize(v.size, size))
          .slice(0, MAX_COLORS)
          .map((v) => ({
            color: cleanText(v.color, 40),
            available: v.stock > 0 && !p.statuses.includes('out_of_stock'),
            // The product page's own "only N left" threshold — no exact counts.
            fewLeft: v.stock > 0 && v.stock <= (v.lowStockAt ?? 0),
          })),
      }))
    : undefined
  return {
    ...base,
    description: cleanText(pick(p.description, locale), DESCRIPTION_CHARS),
    specs: (p.specs ?? []).slice(0, MAX_SPECS).map((s) => ({ label: cleanText(s.label, 40), value: cleanText(s.value, 80) })),
    deliveryDays: deliveryDaysFor(p, businessToCalendarDays(storeTimeframe)),
    hasSizeGuide: Boolean(p.sizeChart?.length),
    isNew: Boolean(p.isNew),
    limitedEdition: Boolean(p.limited || p.statuses.includes('limited_edition')),
    ...(availability ? { availability } : {}),
  }
}

export function card(p: Product, locale: StorefrontLocale): ProductCard {
  return {
    id: p.id,
    name: pick(p.name, locale) || p.id,
    price: p.price,
    ...(p.oldPrice && p.oldPrice > p.price ? { oldPrice: p.oldPrice } : {}),
    image: p.image,
    path: productPath(p.id, locale),
    stock: stockState(p),
  }
}

/** A product id as the model may pass it: a slug, or a product URL. */
export function productIdFrom(raw: string): string | null {
  const value = String(raw ?? '').trim()
  const fromUrl = /\/product\/([a-z0-9][a-z0-9-]{0,99})(?:[/?#]|$)/i.exec(value)
  const id = (fromUrl ? fromUrl[1] : value).toLowerCase()
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(id) ? id : null
}

export function findProduct(catalog: Catalog, id: string): Product | null {
  return catalog.products.find((p) => p.id === id) ?? null
}

export type SearchArgs = {
  query?: string
  category?: string
  color?: string
  size?: string
  maxPriceChf?: number
  minPriceChf?: number
  inStockOnly?: boolean
  limit: number
}

/** Keyword search in Postgres (search_products, migration 0058) — ranks
 *  names and descriptions and forgives typos. Injected for tests. */
export type KeywordSearch = (query: string) => Promise<string[]>

/**
 * The search tool. Hard requirements (price, size, availability, and the
 * category and colour the reader recognised) are never loosened: "under 300"
 * that returns a 900 coat is a wrong answer, not a near miss.
 */
export async function searchCatalog(
  catalog: Catalog,
  args: SearchArgs,
  locale: StorefrontLocale,
  keywordSearch?: KeywordSearch,
): Promise<{ results: ProductSummary[]; total: number; relaxed: string[]; products: Product[] }> {
  const text = [args.query, args.category, args.color].filter(Boolean).join(' ').trim()
  const categoryLabels: Record<string, LocalizedText | undefined> = { ...CATEGORY_LABELS }
  for (const c of catalog.categories) categoryLabels[c.slug] = c.name
  const groupLabels: Record<string, LocalizedText | undefined> = { ...GROUP_LABELS }
  for (const g of catalog.collections) groupLabels[g.slug] = g.name
  const ctx = buildSearchContext({
    products: catalog.products,
    categoryLabels,
    groupLabels,
    categorySlugs: catalog.categories.map((c) => c.slug),
    groupSlugs: catalog.collections.map((g) => g.slug),
    currency: 'CHF',
  })

  const reading = text ? interpretQuery(text, ctx) : { filters: [] as SearchFilter[], keywords: [] as string[] }
  // Explicit numbers win over prices the reader found in the words.
  const filters = reading.filters.filter(
    (f) =>
      !(f.kind === 'maxPrice' && args.maxPriceChf !== undefined) &&
      !(f.kind === 'minPrice' && args.minPriceChf !== undefined),
  )
  if (args.maxPriceChf !== undefined) {
    filters.push({ kind: 'maxPrice', value: args.maxPriceChf, amount: args.maxPriceChf, currency: 'CHF', phrase: '' })
  }
  if (args.minPriceChf !== undefined) {
    filters.push({ kind: 'minPrice', value: args.minPriceChf, amount: args.minPriceChf, currency: 'CHF', phrase: '' })
  }
  if (args.inStockOnly) filters.push({ kind: 'inStock', value: true, phrase: '' })

  const hardOk = (p: Product): boolean => {
    if (args.maxPriceChf !== undefined && p.price > args.maxPriceChf) return false
    if (args.minPriceChf !== undefined && p.price < args.minPriceChf) return false
    if (args.inStockOnly && stockState(p) === 'sold_out') return false
    if (args.size) {
      const state = sizeState(p, args.size)
      if (state === 'not_offered') return false
      if (args.inStockOnly && state === 'sold_out') return false
    }
    return true
  }

  let { products, relaxed } = matchProducts(catalog.products, { filters, keywords: reading.keywords })
  products = products.filter(hardOk)

  // Nothing by attributes, but there were words: Postgres' ranked search
  // (names, descriptions, misspellings), then the same hard requirements —
  // the colour, category and brand the reader recognised included, so "white
  // coat" never comes back as the black one.
  if (products.length === 0 && args.query && keywordSearch) {
    try {
      const slugs = await keywordSearch(args.query)
      const byId = new Map(catalog.products.map((p) => [p.id, p]))
      const found = slugs.map((s) => byId.get(s)).filter((p): p is Product => Boolean(p))
      products = matchProducts(found, { filters, keywords: [] }).products.filter(hardOk)
      relaxed = []
    } catch {
      // The attribute search already answered; a failed fallback is no answer.
    }
  }

  const shown = products.slice(0, args.limit)
  return {
    results: shown.map((p) => summarize(catalog, p, locale, args.size)),
    total: products.length,
    relaxed,
    products: shown,
  }
}
