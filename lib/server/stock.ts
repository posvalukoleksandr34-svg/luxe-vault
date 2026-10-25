import 'server-only'

import { listingSupported } from '@/lib/server/catalog-store'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Live variant stock, read straight from public.product_variants.
 *
 * The storefront's copy of the catalogue can be up to a minute old (ISR and
 * the CDN cache on /api/catalog), which is fine for showing a badge and wrong
 * for deciding how many units a customer may put in their basket. Every
 * add-to-cart and cart refresh asks this instead (POST /api/cart/validate).
 *
 * It is a check, not a reservation: a basket holds nothing. The reservation is
 * place_order() (migration 0012), which decrements stock with `stock >= qty`
 * inside the order's own transaction — the only step that can be raced, and
 * the one the database settles.
 */

export const variantKey = (slug: string, size: string, color: string) => `${slug}|${size}|${color}`

export type StockSnapshot = {
  /** Slugs on sale (published, 0062). Anything else has 0 available. */
  forSale: Set<string>
  /** Slugs whose stock is counted. A product with no variant rows is not. */
  tracked: Set<string>
  /** variantKey → units on hand. A tracked product's missing combination is 0. */
  stock: Map<string, number>
}

export async function readVariantStock(slugs: string[]): Promise<StockSnapshot> {
  const unique = Array.from(new Set(slugs.filter(Boolean))).slice(0, 100)
  const snapshot: StockSnapshot = { forSale: new Set(), tracked: new Set(), stock: new Map() }
  if (unique.length === 0) return snapshot
  // Without 0062 nothing records what may be sold: nothing is (fail closed).
  if (!(await listingSupported())) return snapshot

  const supabase = createAdminClient()
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, slug')
    .in('slug', unique)
    .eq('listing_status', 'published')
  if (productsError) throw new Error(`Failed to read products: ${productsError.message}`)

  const slugById = new Map((products ?? []).map((p) => [p.id as string, p.slug as string]))
  for (const slug of slugById.values()) snapshot.forSale.add(slug)
  if (slugById.size === 0) return snapshot

  const { data: variants, error: variantsError } = await supabase
    .from('product_variants')
    .select('product_id, size, color, stock')
    .in('product_id', Array.from(slugById.keys()))
  if (variantsError) throw new Error(`Failed to read stock: ${variantsError.message}`)

  for (const v of variants ?? []) {
    const slug = slugById.get(v.product_id as string)
    if (!slug) continue
    snapshot.tracked.add(slug)
    snapshot.stock.set(variantKey(slug, v.size as string, v.color as string), Math.max(0, Number(v.stock) || 0))
  }
  return snapshot
}

/**
 * Units available for one variant: 0 for a product that is not on sale
 * (unknown, draft or withdrawn), a number for a tracked product (0 when the
 * combination has no row — place_order treats it the same way), or null when
 * the product's stock is not counted at all.
 */
export function availableFor(snapshot: StockSnapshot, slug: string, size: string, color: string): number | null {
  if (!snapshot.forSale.has(slug)) return 0
  if (!snapshot.tracked.has(slug)) return null
  return snapshot.stock.get(variantKey(slug, size, color)) ?? 0
}
