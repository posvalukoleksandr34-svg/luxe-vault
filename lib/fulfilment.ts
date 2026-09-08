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

  /** Express skips the supplier queue for stock already on hand. */
  expressSupply: { min: 2, max: 5 },

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


export type ShippingType = 'standard' | 'express'

/**
 * What delivery costs.
 *
 * PLACEHOLDER RATES. These are in the right shape and the right ballpark for
 * Swiss Post parcels, but they are a business decision, not a technical one —
 * set them to what shipping actually costs you. Everything that displays or
 * charges for delivery reads this object, so changing a number here is the
 * whole change.
 *
 * `freeAbove` is a threshold on the discounted subtotal, not the total: free
 * shipping earned by a large order should not evaporate because the order also
 * qualified for a discount code.
 */
export const SHIPPING = {
  standard: { price: 9.9, freeAbove: 200 },
  /** Express skips the supplier queue, and is never free — the cost is real
   *  and a "free express" offer would be paid for out of margin. */
  express: { price: 24.9, freeAbove: null },
} as const

/**
 * Tax rate applied to an order.
 *
 * Zero, deliberately. The shop trades as a Swiss Privatverkauf — a private
 * individual, not VAT-registered and below the CHF 100k registration
 * threshold — so it must not charge or display VAT. See migration 0014.
 *
 * If the seller registers, set this to 0.081 and the line appears everywhere
 * at once; nothing else needs to change.
 */
export const TAX_RATE = 0

/**
 * The delivery charge for a basket, computed server-side.
 *
 * Takes the already-discounted subtotal so the free-shipping threshold is
 * applied to what the customer is actually spending.
 */
export function quoteShipping(
  discountedSubtotal: number,
  shipping: ShippingType = 'standard',
): number {
  const rule = SHIPPING[shipping]
  if (rule.freeAbove !== null && discountedSubtotal >= rule.freeAbove) return 0
  return rule.price
}

/**
 * How much more the customer needs to spend to earn free shipping.
 *
 * Returns null when the threshold is already met or does not exist, so the
 * caller renders nothing rather than "0 CHF to go".
 */
export function freeShippingGap(
  discountedSubtotal: number,
  shipping: ShippingType = 'standard',
): { remaining: number; threshold: number } | null {
  const rule = SHIPPING[shipping]
  if (rule.freeAbove === null) return null
  if (discountedSubtotal >= rule.freeAbove) return null
  return {
    remaining: Math.round((rule.freeAbove - discountedSubtotal) * 100) / 100,
    threshold: rule.freeAbove,
  }
}

/** End-to-end window per shipping type. Express shortens the supplier leg
 *  only — dispatch and postal transit are the same parcel either way. */
export function windowFor(shipping: ShippingType): Range {
  const supply = shipping === 'express' ? FULFILMENT.expressSupply : FULFILMENT.supply
  return {
    min: supply.min + FULFILMENT.dispatch.min + FULFILMENT.transit.min,
    max: supply.max + FULFILMENT.dispatch.max + FULFILMENT.transit.max,
  }
}

/**
 * The window to STAMP on a new order.
 *
 * Called once, server-side, at creation. Everything afterwards reads the
 * stored dates — see migration 0011 for why the promise is frozen rather than
 * recomputed on every render.
 */
export function quoteDeliveryWindow(
  createdAt: number,
  shipping: ShippingType = 'standard',
): { min: Date; max: Date } {
  const w = windowFor(shipping)
  const d = (days: number) => {
    const x = new Date(createdAt)
    x.setDate(x.getDate() + days)
    return x
  }
  return { min: d(w.min), max: d(w.max) }
}

// ------------------------------------------------------------------ couriers

/**
 * Tracking deep-links, keyed by a normalised carrier name.
 *
 * A number alone makes the customer find the carrier's site and paste it; a
 * link is the difference between "we told you" and "you can check". Unknown
 * carriers simply render the number with no link rather than guessing a URL
 * that 404s.
 */
const COURIERS: { match: RegExp; label: string; url: (n: string) => string }[] = [
  {
    match: /swiss\s*post|die\s*post|la\s*poste|post\.ch/i,
    label: 'Swiss Post',
    url: (n) => `https://service.post.ch/ekp-web/ui/entry/search/${encodeURIComponent(n)}`,
  },
  {
    match: /dhl/i,
    label: 'DHL',
    url: (n) => `https://www.dhl.com/ch-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  },
  {
    match: /\bups\b/i,
    label: 'UPS',
    url: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  },
  {
    match: /fedex/i,
    label: 'FedEx',
    url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  },
  {
    match: /\bdpd\b/i,
    label: 'DPD',
    url: (n) => `https://tracking.dpd.de/status/en_US/parcel/${encodeURIComponent(n)}`,
  },
]

/** Known carrier names, for the admin's picker. */
export const COURIER_NAMES = COURIERS.map((c) => c.label)

export function courierTrackingUrl(
  courier: string | undefined,
  trackingNumber: string | undefined,
): { label: string; url: string } | null {
  if (!courier?.trim() || !trackingNumber?.trim()) return null
  const hit = COURIERS.find((c) => c.match.test(courier))
  if (!hit) return null
  return { label: hit.label, url: hit.url(trackingNumber.trim()) }
}
