import 'server-only'

import { CATEGORY_LABELS, translate } from '@/lib/i18n'
import { primaryText } from '@/lib/localized-text'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyLowStock, type LowStockVariant } from '@/lib/telegram'
import type { Order } from '@/lib/types'

/**
 * After an order is placed, warn the stock topic about any variant it took to
 * its last few pieces.
 *
 * WHERE THE NUMBER COMES FROM. Stock is taken inside place_order() — the same
 * transaction that creates the order, with `where stock >= qty` as its guard
 * (migration 0012). So by the time this runs the count is already the new one,
 * and it is READ BACK from product_variants rather than computed here from the
 * old value minus the quantity: two customers buying the last pieces at once
 * would each compute from the same starting number, while the table has the
 * truth after both.
 *
 * WHAT COUNTS AS LOW: two or fewer, as a flat line. Each variant also carries
 * its own `low_stock_at` (what the storefront uses for "only N left"), and a
 * limited watch and a basic tee arguably deserve different thresholds — but
 * the alert is about "reorder now", and two is where that is true for
 * everything the shop sells today.
 *
 * A product with no variant rows is not "out of stock", it is untracked —
 * nobody is counting it — so it never alerts.
 *
 * NEVER THROWS. The order already exists and the customer is waiting on the
 * response; an inventory alert must not be what fails their checkout. Every
 * failure is logged and swallowed.
 */

export const LOW_STOCK_AT = 2

export async function warnIfLowStock(order: Order): Promise<void> {
  try {
    const slugs = Array.from(new Set((order.items ?? []).map((i) => i.productId).filter(Boolean)))
    if (slugs.length === 0) return

    const { data, error } = await createAdminClient()
      .from('product_variants')
      .select('size, color, stock, products!inner(slug, name, categories(slug))')
      .in('products.slug', slugs)
      .lte('stock', LOW_STOCK_AT)

    if (error) {
      console.warn(`[low-stock] could not read stock after ${order.id}: ${error.message}`)
      return
    }

    type Row = {
      size: string
      color: string
      stock: number
      products: { slug: string; name: Record<string, string>; categories: { slug: string } | null } | null
    }

    // Only the variants THIS order bought. Other sizes of the same product may
    // be low too, but this order did not change them, and alerting on them
    // after every sale of a neighbouring size would repeat old news.
    const bought = new Set(order.items.map((i) => `${i.productId}|${i.size}|${i.color}`))
    const low: LowStockVariant[] = ((data ?? []) as unknown as Row[])
      .filter((r) => r.products && bought.has(`${r.products.slug}|${r.size}|${r.color}`))
      .map((r) => {
        const categorySlug = r.products?.categories?.slug ?? ''
        return {
          productName: primaryText(r.products?.name, r.products?.slug ?? ''),
          category: translate(CATEGORY_LABELS[categorySlug], 'en') || categorySlug || '—',
          size: r.size,
          color: r.color,
          stock: r.stock,
        }
      })
      // Sold out first: it is the one to act on today.
      .sort((a, b) => a.stock - b.stock)

    if (low.length === 0) return
    await notifyLowStock(order.id, low)
  } catch (e) {
    console.warn(`[low-stock] check failed after ${order.id}:`, (e as Error).message)
  }
}
