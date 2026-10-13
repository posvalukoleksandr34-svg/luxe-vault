import 'server-only'

import { formatMoney } from '@/lib/currency'
import { FULFILMENT, courierTrackingUrl } from '@/lib/fulfilment'
import { getOrdersByCredentials, getOrdersByUserId } from '@/lib/server/orders-store'
import type { Order } from '@/lib/types'

/**
 * The assistant's view of orders: ONLY the requester's own.
 *
 * An order number (LV- plus six characters) is guessable, so it is never
 * enough on its own — the same rule as /api/orders/lookup. The assistant sees
 * the orders bound to the signed-in account plus those this browser holds a
 * lookup token for, and nothing else. Asked about any other number, it gets
 * "not visible" — never whether that order exists — so the chat cannot be
 * used to enumerate orders or read someone else's.
 *
 * And only what an answer needs: status, dates, tracking, items by name.
 * Never the name, address, phone or email — that is not needed to say where a
 * parcel is, and it would otherwise be sent to the model provider.
 */

export type OrderCredential = { id: string; token: string }

const MAX_CREDENTIALS = 50
const DAY = 24 * 60 * 60 * 1000

/** "#lv abc123", "LVABC123", "abc123" → "LV-ABC123"; null when it cannot be one. */
export function normalizeOrderNumber(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[#\s№]/g, '')
  const match = /^(?:LV-?)?([A-Z0-9]{6})$/.exec(compact)
  return match ? `LV-${match[1]}` : null
}

/** A lookup token as order-drafts.ts issues them (32 characters), with room
 *  for older formats — but never markup, separators or a kilobyte of junk. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/

/**
 * The browser's order credentials, checked: an order number and a token of
 * the right shape, each pair once, at most 50. Whether the token is RIGHT is
 * decided by getOrdersByCredentials (constant-time compare against the
 * stored one); this only keeps malformed input out of the query.
 */
export function readCredentials(value: unknown): OrderCredential[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: OrderCredential[] = []
  for (const entry of value.slice(0, MAX_CREDENTIALS * 2)) {
    if (typeof entry?.id !== 'string' || typeof entry?.token !== 'string') continue
    const id = normalizeOrderNumber(entry.id)
    if (!id || !TOKEN_SHAPE.test(entry.token)) continue
    const key = `${id}:${entry.token}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id, token: entry.token })
    if (out.length === MAX_CREDENTIALS) break
  }
  return out
}

/** Everything the requester may see, newest first: the signed-in account's
 *  orders (`userId`, from the verified session) and the browser's tokens.
 *
 *  A lookup that fails THROWS rather than returning what is left: an empty or
 *  partial list would read as "that order is not yours to see", which is
 *  wrong when the database is simply unavailable. The tool loop turns the
 *  error into "cannot check right now" (chat.ts). */
export async function requesterOrders(credentials: OrderCredential[], userId: string | null): Promise<Order[]> {
  let account: Order[] = []
  let failed = false
  try {
    if (userId) account = await getOrdersByUserId(userId)
  } catch (e) {
    failed = true
    console.warn('[assistant] account orders unavailable:', (e as Error).message)
  }
  let tokens: Order[] = []
  try {
    tokens = credentials.length > 0 ? await getOrdersByCredentials(credentials) : []
  } catch (e) {
    failed = true
    console.warn('[assistant] token orders unavailable:', (e as Error).message)
  }
  if (failed) throw new Error('orders_unavailable')
  const byId = new Map<string, Order>()
  for (const order of [...account, ...tokens]) byId.set(order.id, order)
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt)
}

const day = (ms: number | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : undefined)

/** What the model is told about one order. */
export function orderForAssistant(order: Order) {
  const tracking = courierTrackingUrl(order.courierName, order.trackingNumber)
  return {
    orderNumber: order.id,
    placedOn: day(order.createdAt),
    status: order.status,
    paymentStatus: order.paymentStatus,
    // Only what the payment record says — "paid" means the provider
    // confirmed it (webhook), never that the customer was redirected back.
    paymentConfirmed: order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded' || order.paymentStatus === 'refunded',
    items: order.items.map((i) => `${i.name} (${i.size}${i.color ? `, ${i.color}` : ''}) ×${i.qty}`),
    total: formatMoney(order.total, 'CHF', true),
    estimatedDelivery:
      order.deliveryEstimateMin && order.deliveryEstimateMax
        ? { from: day(order.deliveryEstimateMin), to: day(order.deliveryEstimateMax) }
        : undefined,
    shippedOn: day(order.shippedAt),
    deliveredOn: day(order.deliveredAt),
    cancelledOn: day(order.cancelledAt),
    tracking: order.trackingNumber
      ? { number: order.trackingNumber, carrier: tracking?.label ?? order.courierName, url: tracking?.url }
      : undefined,
    returnStatus: order.returnStatus && order.returnStatus !== 'none' ? order.returnStatus : undefined,
    refunded: order.refundedAmount && order.refundedAmount > 0 ? formatMoney(order.refundedAmount, 'CHF', true) : undefined,
    returnWindowEndsOn: order.deliveredAt ? day(order.deliveredAt + FULFILMENT.returnWindowDays * DAY) : undefined,
  }
}

/** A one-line entry for "which order do you mean?". */
export function orderSummary(order: Order) {
  return {
    orderNumber: order.id,
    placedOn: day(order.createdAt),
    status: order.status,
    items: order.items.map((i) => i.name).slice(0, 3),
  }
}
