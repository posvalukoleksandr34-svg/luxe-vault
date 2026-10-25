import 'server-only'

import { getProductsBySlugs } from '@/lib/server/catalog-store'
import type { Order } from '@/lib/types'

/**
 * The products in this order that are no longer on sale — withdrawn, back to
 * draft, or deleted (migration 0062).
 *
 * Asked before a new payment is started for an existing order ("pay now" in
 * the account, a crypto payment resumed later): an order placed while a
 * piece was on sale must not be paid after the owner took it off sale, which
 * would sell it anyway. Placing a new order needs no such check — it is
 * priced from the public catalogue, which holds published products only.
 */
export async function productsNotOnSale(order: Pick<Order, 'items'>): Promise<string[]> {
  const slugs = Array.from(new Set(order.items.map((i) => i.productId).filter(Boolean)))
  if (slugs.length === 0) return []
  const onSale = new Set((await getProductsBySlugs(slugs)).map((p) => p.id))
  return slugs.filter((s) => !onSale.has(s))
}
