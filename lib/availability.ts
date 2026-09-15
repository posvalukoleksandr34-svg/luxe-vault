// A product's availability tag ("in_stock" / "out_of_stock" in
// Product.statuses), derived from its variant stock whenever it tracks stock.
//
// One rule, used by the admin form (live, as quantities are typed) and by the
// server before it writes (lib/server/catalog-store.ts). The database applies
// the same rule on every later stock change — a sale, a cancellation, an
// inventory edit — in migration 0032, so the tag can never drift from the
// quantities it describes.
import type { StatusKey, Variant } from './types'

/** The availability pair. A product carries exactly one of them. */
export const AVAILABILITY_STATUSES: StatusKey[] = ['in_stock', 'out_of_stock']

/** Units across every size and colour, or null when the product does not
 *  track stock (no variant rows) — which is NOT the same as none left. */
export function totalVariantStock(variants: Pick<Variant, 'stock'>[] | undefined): number | null {
  if (!variants || variants.length === 0) return null
  return variants.reduce((sum, v) => sum + Math.max(0, Math.trunc(Number(v.stock) || 0)), 0)
}

/** In stock when the variants add up to more than zero, out of stock at zero;
 *  null for an untracked product, whose tag the admin sets by hand. */
export function derivedAvailability(
  variants: Pick<Variant, 'stock'>[] | undefined,
): 'in_stock' | 'out_of_stock' | null {
  const total = totalVariantStock(variants)
  return total === null ? null : total > 0 ? 'in_stock' : 'out_of_stock'
}

/**
 * The statuses with exactly one availability tag: the derived one when stock
 * is tracked, otherwise the admin's own (in stock when there is none). Every
 * other tag is kept, and the availability tag keeps its place in the list so
 * the storefront's badges do not reorder.
 */
export function withDerivedAvailability(
  statuses: StatusKey[],
  variants: Pick<Variant, 'stock'>[] | undefined,
): StatusKey[] {
  const manual = statuses.find((s) => AVAILABILITY_STATUSES.includes(s))
  const tag: StatusKey = derivedAvailability(variants) ?? manual ?? 'in_stock'

  const out: StatusKey[] = []
  let placed = false
  for (const s of statuses) {
    if (!AVAILABILITY_STATUSES.includes(s)) out.push(s)
    else if (!placed) {
      out.push(tag)
      placed = true
    }
  }
  if (!placed) out.push(tag)
  return out
}
