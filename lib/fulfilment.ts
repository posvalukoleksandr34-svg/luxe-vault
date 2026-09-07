import type { Order } from '@/lib/types'

/**
 * Every delivery, processing and returns window in one place.
 *
 * These numbers were previously hardcoded into translated prose in five
 * languages across i18n, the order tracker, the notification triggers and the
 * legal pages. Changing "20–35 days" meant finding and editing roughly twenty
 * strings, and the audit that produced this file found the inevitable result:
 * the delivery FAQ promised "4–5 business days" while the order tracker said
 * "20–35 days". Both were visible to the same customer.
 *
 * Change a number here and every surface follows.
 */
export const FULFILMENT = {
  /** Supplier lead time — ordering the item and quality-checking it. */
  supply: { min: 20, max: 35 },

  /** Packing and handing the parcel to Swiss Post, after payment clears. */
  dispatch: { min: 2, max: 4 },

  /** Swiss Post transit once dispatched. Region-dependent. */
  transit: { min: 4, max: 5 },

  /** Days to notify of withdrawal after delivery (Policy §2). */
  returnWindowDays: 14,

  /** Bank turnaround on a refund, after it is issued. */
  refund: { min: 5, max: 10 },

  /** Target first response on a support enquiry or refund request. */
  supportReply: { min: 1, max: 2 },
} as const

export type Range = { min: number; max: number }

/**
 * Total customer-visible window: supplier lead time plus dispatch plus
 * transit. This is the honest end-to-end figure, and is what the tracker's
 * headline shows.
 */
export const TOTAL_WINDOW: Range = {
  min: FULFILMENT.supply.min + FULFILMENT.dispatch.min + FULFILMENT.transit.min,
  max: FULFILMENT.supply.max + FULFILMENT.dispatch.max + FULFILMENT.transit.max,
}

function addDays(from: number, days: number): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Projected delivery window for a specific order.
 *
 * Driven by status and the timestamps the database already stamps, so the
 * estimate tightens as the order advances rather than repeating one static
 * sentence for a month:
 *
 *   pending / processing  → createdAt + the full window
 *   shipped               → shippedAt + transit only (the wait is nearly over)
 *   delivered             → the actual delivery date, not an estimate
 *   cancelled / refunded   → null; there is nothing arriving
 */
export function estimateDelivery(
  order: Pick<Order, 'status' | 'createdAt' | 'shippedAt' | 'deliveredAt'>,
): { earliest: Date; latest: Date; exact?: Date } | null {
  if (order.status === 'cancelled' || order.status === 'refunded') return null

  if (order.status === 'delivered' && order.deliveredAt) {
    const d = new Date(order.deliveredAt)
    return { earliest: d, latest: d, exact: d }
  }

  if (order.status === 'shipped' && order.shippedAt) {
    return {
      earliest: addDays(order.shippedAt, FULFILMENT.transit.min),
      latest: addDays(order.shippedAt, FULFILMENT.transit.max),
    }
  }

  return {
    earliest: addDays(order.createdAt, TOTAL_WINDOW.min),
    latest: addDays(order.createdAt, TOTAL_WINDOW.max),
  }
}

/**
 * "12 – 27 October" style range, collapsing to one date when both ends match.
 *
 * Uses the customer's locale via Intl rather than a hand-built string: month
 * names and day/month order differ across the five languages this site ships,
 * and getting that wrong on a delivery date is worse than showing nothing.
 */
export function formatDeliveryWindow(
  window: { earliest: Date; latest: Date; exact?: Date },
  locale: string,
): string {
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
  if (window.exact) return fmt.format(window.exact)

  const a = fmt.format(window.earliest)
  const b = fmt.format(window.latest)
  return a === b ? a : `${a} — ${b}`
}
