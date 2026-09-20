import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * What size people actually bought, per product.
 *
 * Counted from order_items joined to their orders, so it reflects real
 * purchases and nothing else. Two rules keep it honest:
 *
 *  - CANCELLED AND REFUNDED ORDERS ARE EXCLUDED. A returned purchase is the
 *    opposite of evidence that a size fits.
 *  - BELOW `MIN_SAMPLE` NOTHING IS REPORTED. "100% chose L" from one order is
 *    a true sentence and a misleading one; the UI shows nothing until the
 *    number means something.
 *
 * It deliberately does NOT claim anything about buyers "with your
 * measurements": orders carry sizes, never bodies, so that comparison cannot
 * be made from this data and is not implied anywhere in the copy.
 */

/** Below this many counted items, the answer is noise. */
export const MIN_SAMPLE = 5

export type SizeStat = {
  /** The size most often bought. */
  size: string
  /** Its share of counted purchases, 0–100, rounded. */
  percent: number
  /** How many items the share is computed from. */
  sample: number
}

export async function readSizeStat(productId: string): Promise<SizeStat | null> {
  if (!productId) return null
  try {
    const { data, error } = await createAdminClient()
      .from('order_items')
      .select('size, qty, orders!inner(status, payment_status)')
      .eq('product_id', productId)
      .not('orders.status', 'in', '("cancelled","refunded")')
      .limit(1000)

    if (error) throw new Error(error.message)

    const counts = new Map<string, number>()
    let total = 0
    for (const row of (data ?? []) as { size?: unknown; qty?: unknown }[]) {
      const size = typeof row.size === 'string' ? row.size.trim() : ''
      const qty = Number(row.qty) || 0
      if (!size || qty <= 0) continue
      counts.set(size, (counts.get(size) ?? 0) + qty)
      total += qty
    }
    if (total < MIN_SAMPLE) return null

    let best: { size: string; n: number } | null = null
    counts.forEach((n, size) => {
      if (!best || n > best.n) best = { size, n }
    })
    if (!best) return null

    const winner = best as { size: string; n: number }
    return { size: winner.size, percent: Math.round((winner.n / total) * 100), sample: total }
  } catch (e) {
    // A missing table or an unreachable database must never break a product
    // page: the fit finder simply shows no statistic.
    console.warn('[size-stats] unavailable:', (e as Error).message)
    return null
  }
}
