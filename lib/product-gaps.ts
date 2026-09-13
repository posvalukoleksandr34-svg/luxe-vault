import type { Locale, Product } from '@/lib/types'

/**
 * What a product is still missing before it is ready to sell — the admin's
 * "needs attention" flags.
 *
 * Computed from the product itself rather than stored, so a flag cannot go
 * stale: fill the field and it disappears. The storefront never shows these;
 * it has its own fallbacks (a placeholder image, hidden empty sections) so
 * that a gap never breaks the layout while it waits for an admin.
 */

export type ProductGap =
  | 'image'
  | 'description'
  | 'translation'
  | 'sizeChart'
  | 'specs'
  | 'delivery'
  | 'price'

/** Admin labels — the admin console is in Russian. */
export const GAP_LABELS: Record<ProductGap, string> = {
  image: 'Нет фото',
  description: 'Нет описания',
  translation: 'Не переведено',
  sizeChart: 'Нет таблицы размеров',
  specs: 'Нет характеристик',
  delivery: 'Срок доставки по умолчанию',
  price: 'Проверьте цену',
}

const LOCALES: Locale[] = ['ru', 'en', 'it', 'fr', 'de']
const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL']

/** Above this a price is almost certainly a typo (an extra zero). */
const PRICE_CEILING = 20000

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function productGaps(p: Product): ProductGap[] {
  const gaps: ProductGap[] = []

  if (!text(p.image) && !(p.images ?? []).some((src) => text(src))) gaps.push('image')

  const descriptions = LOCALES.map((l) => text(p.description?.[l]))
  if (!descriptions.some(Boolean)) gaps.push('description')

  // Untranslated: a language with no name, or every other language still
  // holding an untouched copy of the Russian description (what the old
  // single-language form saved). Identical NAMES alone are allowed — a name
  // that is just a brand is the same in every language.
  const names = LOCALES.map((l) => text(p.name?.[l]))
  const ruDescription = descriptions[0]
  const copiedDescription = Boolean(ruDescription) && descriptions.slice(1).every((d) => d === ruDescription)
  if (names.some((n) => !n) || (descriptions.some(Boolean) && descriptions.some((d) => !d)) || copiedDescription) {
    gaps.push('translation')
  }

  // Letter sizes are clothing: a customer choosing between M and L needs the
  // measurements. Shoe and one-size products do not.
  const lettered = p.sizes.some((s) => LETTER_SIZES.indexOf(s.toUpperCase()) !== -1)
  if (lettered && !(p.sizeChart?.length)) gaps.push('sizeChart')

  if (!(p.specs?.length)) gaps.push('specs')

  // Still on the store-wide default estimate rather than this product's own.
  if (!p.deliveryDays) gaps.push('delivery')

  const oldPriceBelow = typeof p.oldPrice === 'number' && p.oldPrice > 0 && p.oldPrice <= p.price
  if (!(p.price > 0) || p.price > PRICE_CEILING || oldPriceBelow) gaps.push('price')

  return gaps
}
