/**
 * What needs someone's attention in the console — the dashboard's first block
 * and the counts beside the navigation. Every number is counted from the
 * database (lib/server/admin-attention.ts); a source that could not be read is
 * `null` and shown as "—", never as a reassuring 0.
 *
 * Pure: the shape, and the stock rule, which is unit-tested.
 */

export type StockAlertItem = {
  variantId: string
  slug: string
  name: string
  size: string
  color: string
  stock: number
  lowStockAt: number
}

export type Attention = {
  /** Paid, not yet shipped (pending / processing). */
  ordersToShip: number | null
  /** Created, payment not yet arrived (pending_payment / confirming). */
  ordersAwaitingPayment: number | null
  /** Not yet shipped, with a fraud flag from the payment guard. */
  ordersFlagged: number | null
  /** Tracked variants at 0. */
  outOfStock: number | null
  /** Tracked variants above 0 but at or under their own threshold. */
  lowStock: number | null
  /** The most urgent of those, out of stock first. */
  stockItems: StockAlertItem[]
  /** Open requests whose last message is the customer's. */
  supportWaiting: number | null
  productReviewsPending: number | null
  storeReviewsPending: number | null
  /** Refund cases waiting for a staff decision or action. */
  refundCasesWaiting: number | null
  /** Review-request emails that failed for good. */
  reviewRequestsFailed: number | null
}

export type VariantStock = {
  id: string
  size: string
  color: string
  stock: number
  low_stock_at: number | null
  product: { slug: string; name: Record<string, string> | null } | null
}

/** Out of stock and running low, most urgent first. */
export function stockAlerts(rows: VariantStock[], limit = 8): { out: number; low: number; items: StockAlertItem[] } {
  let out = 0
  let low = 0
  const items: StockAlertItem[] = []
  for (const r of rows) {
    const stock = Math.max(0, Number(r.stock) || 0)
    const threshold = Math.max(0, Number(r.low_stock_at ?? 0) || 0)
    const isOut = stock === 0
    const isLow = !isOut && stock <= threshold
    if (!isOut && !isLow) continue
    if (isOut) out++
    else low++
    items.push({
      variantId: r.id,
      slug: r.product?.slug ?? '',
      name: r.product?.name?.ru || r.product?.name?.en || r.product?.slug || '—',
      size: r.size,
      color: r.color,
      stock,
      lowStockAt: threshold,
    })
  }
  items.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
  return { out, low, items: items.slice(0, limit) }
}
