import type { Product } from '@/lib/types'

/**
 * Whether a product is on sale, and what it needs before it may be.
 *
 * A product is public only when it is PUBLISHED (migration 0062). Publishing
 * needs two things, and the server refuses it without either:
 *
 *   1. The owner's record of the basis for selling it (`RightsRecord`): the
 *      shop's own design without third-party marks, or genuine goods the shop
 *      is entitled to resell — with a reference the owner can produce on
 *      request. Nothing here judges or fills in that record; it only checks
 *      that one was made.
 *   2. The facts a buyer needs to decide (`publishBlockers`): a photo, a name
 *      and description a visitor can read, a valid price, sizes and colours,
 *      materials, and measurements for letter-sized clothing.
 *
 * Pure, so the editor can show the same list the server enforces.
 */

export type ListingStatus = 'draft' | 'published' | 'withdrawn'
export const LISTING_STATUSES: ListingStatus[] = ['draft', 'published', 'withdrawn']

export type RightsBasis = 'own_design' | 'authorized_resale'
export const RIGHTS_BASES: RightsBasis[] = ['own_design', 'authorized_resale']

/** The owner's record. Server-only data: never part of a public product. */
export type RightsRecord = {
  basis: RightsBasis
  reference: string
  confirmedAt: number
}

/** What the admin sees about a product's sale state. */
export type ProductListing = {
  status: ListingStatus
  publishedAt?: number
  rights?: RightsRecord
}

/** Admin labels — the console is in Russian. */
export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: 'Черновик',
  published: 'В продаже',
  withdrawn: 'Снят с продажи',
}

export const RIGHTS_BASIS_LABELS: Record<RightsBasis, string> = {
  own_design: 'Собственное изделие без чужих товарных знаков и дизайнов',
  authorized_resale: 'Оригинальный товар бренда, право перепродажи подтверждено',
}

export const RIGHTS_REFERENCE_LIMITS = { min: 3, max: 500 } as const

export type PublishBlocker =
  | 'image'
  | 'name'
  | 'description'
  | 'price'
  | 'sizes'
  | 'colors'
  | 'specs'
  | 'sizeChart'

export const PUBLISH_BLOCKER_LABELS: Record<PublishBlocker, string> = {
  image: 'Нет фото',
  name: 'Нет названия на языке витрины (en, it, fr или de)',
  description: 'Нет описания на языке витрины (en, it, fr или de)',
  price: 'Цена не указана или вне допустимого диапазона',
  sizes: 'Не указаны размеры',
  colors: 'Не указаны цвета',
  specs: 'Нет характеристик (состав, материалы, уход)',
  sizeChart: 'Нет таблицы размеров для одежды с буквенными размерами',
}

/** The languages a visitor can read; Russian is the console's, never shown. */
const STOREFRONT = ['en', 'it', 'fr', 'de'] as const
const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL']
/** Above this a price is almost certainly a typo (an extra zero). */
const PRICE_CEILING = 20000

const filled = (value: unknown) => typeof value === 'string' && value.trim() !== ''

/** What is missing before this product can be put on sale. Empty = ready. */
export function publishBlockers(p: Product): PublishBlocker[] {
  const out: PublishBlocker[] = []
  if (!filled(p.image) && !(p.images ?? []).some(filled)) out.push('image')
  if (!STOREFRONT.some((l) => filled(p.name?.[l]))) out.push('name')
  if (!STOREFRONT.some((l) => filled(p.description?.[l]))) out.push('description')
  if (!(typeof p.price === 'number' && p.price > 0 && p.price <= PRICE_CEILING)) out.push('price')
  if (!(p.sizes ?? []).some(filled)) out.push('sizes')
  if (!(p.colors ?? []).some((c) => filled(c?.name))) out.push('colors')
  if (!(p.specs ?? []).some((s) => filled(s?.label) && filled(s?.value))) out.push('specs')
  const lettered = (p.sizes ?? []).some((s) => LETTER_SIZES.indexOf(String(s).toUpperCase()) !== -1)
  if (lettered && !(p.sizeChart?.length)) out.push('sizeChart')
  return out
}

/** Why this rights record cannot be accepted, or null when it can. */
export function rightsProblem(input: { basis?: unknown; reference?: unknown; confirmed?: unknown }): string | null {
  if (typeof input.basis !== 'string' || RIGHTS_BASES.indexOf(input.basis as RightsBasis) === -1) {
    return 'Выберите основание продажи'
  }
  const reference = typeof input.reference === 'string' ? input.reference.trim() : ''
  if (reference.length < RIGHTS_REFERENCE_LIMITS.min) {
    return 'Укажите, чем подтверждается право продажи (счёт, договор, файл дизайна)'
  }
  if (reference.length > RIGHTS_REFERENCE_LIMITS.max) {
    return `Подтверждение — не длиннее ${RIGHTS_REFERENCE_LIMITS.max} символов`
  }
  if (input.confirmed !== true) return 'Подтвердите, что сведения верны'
  return null
}

/** A product as the storefront may see it: only published ones, no listing data. */
export function isPublished(p: Pick<Product, 'listing'>): boolean {
  return p.listing?.status === 'published'
}
