import type { Category, Product } from '@/lib/types'

/**
 * The photograph on a subcategory card (department pages) and its preview in
 * the admin, decided in one place so the two cannot disagree:
 *
 *   1. the cover the admin chose for that subcategory (Admin → Разделы, 0054);
 *   2. else the subcategory's own best product: the first in stock, else any
 *      with a photo;
 *   3. else none — the card shows the subcategory's initial.
 *
 * Matched on department AND slug: since 0040 a slug is unique only within its
 * department (Women, Men and Kids each have "clothing").
 */
export type SubcategoryCover = { src?: string; source: 'custom' | 'product' | 'none' }

const inStock = (p: Product) =>
  !p.statuses?.includes('out_of_stock') &&
  !(p.variants && p.variants.length > 0 && p.variants.every((v) => (v.stock ?? 1) <= 0))

export function subcategoryCover(
  categories: Pick<Category, 'collectionSlug' | 'slug' | 'image'>[],
  products: Pick<Product, 'group' | 'category' | 'image' | 'statuses' | 'variants'>[],
  group: string,
  slug: string,
): SubcategoryCover {
  const custom = categories.find((c) => c.collectionSlug === group && c.slug === slug)?.image
  if (custom) return { src: custom, source: 'custom' }
  const own = products.filter((p) => p.group === group && p.category === slug && p.image)
  const pick = own.find((p) => inStock(p as Product)) ?? own[0]
  return pick?.image ? { src: pick.image, source: 'product' } : { source: 'none' }
}
