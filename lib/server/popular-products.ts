import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/** How far back sales count towards "popular". */
const WINDOW_DAYS = 180

/**
 * Units sold per product slug over the last WINDOW_DAYS, from orders whose
 * money arrived (paid, or paid and partly refunded). The homepage ranks its
 * four products by this; unpaid and fully refunded orders say nothing about
 * what customers actually buy.
 *
 * order_items.product_id is the product's slug (Product.id), and the orders
 * join is the item's own foreign key, filtered in the database.
 */
export async function unitsSoldByProduct(): Promise<Map<string, number>> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await createAdminClient()
    .from('order_items')
    .select('product_id, qty, orders!inner(payment_status, created_at)')
    .in('orders.payment_status', ['paid', 'partially_refunded'])
    .gte('orders.created_at', since)
    .limit(10_000)

  if (error) throw new Error(`Failed to read sales: ${error.message}`)

  const units = new Map<string, number>()
  for (const row of (data ?? []) as unknown as { product_id: string; qty: number }[]) {
    units.set(row.product_id, (units.get(row.product_id) ?? 0) + Number(row.qty || 0))
  }
  return units
}
