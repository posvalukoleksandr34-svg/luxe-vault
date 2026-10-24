import 'server-only'

import { stockAlerts, type Attention, type VariantStock } from '@/lib/admin-attention'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The counts behind lib/admin-attention.ts. Each is its own query and its own
 * failure: a table that is missing (a migration not yet applied) or an error
 * makes that one count `null`, logged, and leaves the others standing.
 */

type Head = { count: number | null; error: { message: string } | null }

async function count(label: string, run: () => PromiseLike<Head>): Promise<number | null> {
  try {
    const { count: n, error } = await run()
    if (error) {
      console.warn(`[admin/attention] ${label}: ${error.message}`)
      return null
    }
    return n ?? 0
  } catch (e) {
    console.warn(`[admin/attention] ${label}: ${(e as Error).message}`)
    return null
  }
}

const REFUND_WAITING = ['requested', 'under_review', 'return_delivered', 'awaiting_inspection', 'approved', 'disputed']

export async function loadAttention(): Promise<Attention> {
  const db = createAdminClient()
  const head = (table: string) => db.from(table).select('id', { count: 'exact', head: true })

  const [
    ordersToShip,
    ordersAwaitingPayment,
    supportWaiting,
    productReviewsPending,
    storeReviewsPending,
    refundCasesWaiting,
    reviewRequestsFailed,
    flagged,
    variants,
  ] = await Promise.all([
    count('orders to ship', () =>
      head('orders').in('payment_status', ['paid', 'partially_refunded']).in('status', ['pending', 'processing']),
    ),
    count('orders awaiting payment', () =>
      head('orders').in('payment_status', ['pending_payment', 'confirming']).neq('status', 'cancelled'),
    ),
    count('support', () =>
      head('support_tickets').in('status', ['open', 'in_progress']).eq('last_message_by', 'customer'),
    ),
    count('product reviews', () => head('reviews').eq('status', 'pending')),
    count('store reviews', () => head('site_reviews').eq('status', 'pending')),
    count('refund cases', () => head('return_requests').in('state', REFUND_WAITING)),
    count('review requests', () => head('review_requests').eq('status', 'failed')),
    // A flag on an order that has not left yet — the one moment it matters.
    (async () => {
      try {
        const { data, error } = await db
          .from('order_payment_risk')
          .select('order_id, orders!inner(status)')
          .not('fraud_flag', 'is', null)
          .in('orders.status', ['pending', 'processing'])
          .limit(500)
        if (error) throw new Error(error.message)
        return (data ?? []).length
      } catch (e) {
        console.warn(`[admin/attention] fraud flags: ${(e as Error).message}`)
        return null
      }
    })(),
    (async () => {
      try {
        const { data, error } = await db
          .from('product_variants')
          .select('id, size, color, stock, low_stock_at, product:products ( slug, name )')
          .order('stock', { ascending: true })
          .limit(5000)
        if (error) throw new Error(error.message)
        return ((data ?? []) as unknown as (VariantStock & { product: VariantStock['product'] | VariantStock['product'][] })[]).map(
          (v) => ({ ...v, product: Array.isArray(v.product) ? (v.product[0] ?? null) : v.product }),
        )
      } catch (e) {
        console.warn(`[admin/attention] stock: ${(e as Error).message}`)
        return null
      }
    })(),
  ])

  const stock = variants ? stockAlerts(variants) : null
  return {
    ordersToShip,
    ordersAwaitingPayment,
    ordersFlagged: flagged,
    outOfStock: stock?.out ?? null,
    lowStock: stock?.low ?? null,
    stockItems: stock?.items ?? [],
    supportWaiting,
    productReviewsPending,
    storeReviewsPending,
    refundCasesWaiting,
    reviewRequestsFailed,
  }
}
