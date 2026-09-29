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

export function readCredentials(value: unknown): OrderCredential[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_CREDENTIALS)
    .filter(
      (entry): entry is OrderCredential =>
        typeof entry?.id === 'string' && typeof entry?.token === 'string' && entry.id.length < 40 && entry.token.length < 200,
    )
    .map((entry) => ({ id: entry.id, token: entry.token }))
}

/** Everything the requester may see, newest first: the signed-in account's
 *  orders (`userId`, from the verified session) and the browser's tokens. */
export async function requesterOrders(credentials: OrderCredential[], userId: string | null): Promise<Order[]> {
  let account: Order[] = []
  try {
    if (userId) account = await getOrdersByUserId(userId)
  } catch (e) {
    console.warn('[assistant] account orders unavailable:', (e as Error).message)
  }
  let tokens: Order[] = []
  try {
    tokens = credentials.length > 0 ? await getOrdersByCredentials(credentials) : []
  } catch (e) {
    console.warn('[assistant] token orders unavailable:', (e as Error).message)
  }
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
