import 'server-only'

import type { CalcOrder } from '@/lib/refunds/calculator'
import type { EligibilityOrder } from '@/lib/refunds/eligibility'
import { toMinor } from '@/lib/refunds/money'
import { COMMITTED_STATUSES, IN_FLIGHT_STATUSES } from '@/lib/refunds/types'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Everything the refund rules need to know about one order, read from the
 * database in one place: the order as charged, its lines, how many units of
 * each other cases already hold, and what the ledger has committed.
 *
 * Nothing here comes from the browser. The calculator and the eligibility
 * rules take these facts; the database functions re-check the parts that
 * matter for money (quantities, the refundable balance) under a lock.
 */

export type OrderLineFacts = {
  orderItemId: string
  productSlug: string
  categorySlug?: string
  name: string
  image?: string
  size: string
  color: string
  qty: number
  unitPriceMinor: number
  /** Units held by OTHER cases that are alive or settled. */
  claimedQty: number
}

export type RefundOrderFacts = {
  id: string
  number: string
  userId?: string
  email?: string
  customerName: string
  status: string
  paymentStatus?: string
  paymentProvider?: string
  paymentId?: string
  paymentCurrency?: string
  paymentAmount?: number
  createdAt: number
  shippedAt?: number
  deliveredAt?: number
  expectedDeliveryBy?: number
  trackingNumber?: string
  courierName?: string
  subtotalMinor: number
  discountMinor: number
  shippingMinor: number
  taxMinor: number
  totalMinor: number
  /** orders.refunded_amount — the ledger's summary. */
  refundedMinor: number
  /** Ledger: succeeded + in flight. */
  committedMinor: number
  inFlight: boolean
  /** Another case on this order already gave the delivery charge back. */
  shippingAlreadyRefunded: boolean
  lines: OrderLineFacts[]
}

const ORDER_SELECT =
  'id, order_number, user_id, customer_email, customer_name, status, payment_status, payment_provider, payment_id, ' +
  'payment_currency, payment_amount, created_at, shipped_at, delivered_at, delivery_estimate_max, tracking_number, ' +
  'courier_name, subtotal, discount, shipping_cost, tax, total, refunded_amount'

const ms = (v: unknown): number | undefined => (typeof v === 'string' && v ? Date.parse(v) : undefined)

/** By the order's uuid or its LV- number. */
export async function loadOrderFacts(ref: { id?: string; number?: string }, excludeCaseId?: string): Promise<RefundOrderFacts | null> {
  const admin = createAdminClient()
  let query = admin.from('orders').select(ORDER_SELECT)
  if (ref.id) query = query.eq('id', ref.id)
  else if (ref.number) query = query.eq('order_number', ref.number)
  else return null
  const { data: order, error } = await query.maybeSingle()
  if (error) throw new Error(`Failed to read the order: ${error.message}`)
  if (!order) return null
  const o = order as unknown as Record<string, unknown>
  const orderId = o.id as string

  const [itemsRes, claimsRes, ledgerRes, shippingRes] = await Promise.all([
    admin
      .from('order_items')
      .select('id, product_id, name, image, size, color, qty, unit_price')
      .eq('order_id', orderId)
      .order('id'),
    admin
      .from('return_request_items')
      .select('order_item_id, qty_requested, qty_approved, return_requests!inner(id, order_id, state)')
      .eq('return_requests.order_id', orderId)
      .not('return_requests.state', 'in', '(rejected,cancelled,expired)'),
    admin.from('refund_transactions').select('amount_minor, status').eq('order_id', orderId),
    admin
      .from('return_requests')
      .select('id')
      .eq('order_id', orderId)
      .in('state', ['approved', 'refund_processing', 'partially_refunded', 'refunded'])
      .eq('approval->>includesShipping', 'true'),
  ])
  for (const r of [itemsRes, claimsRes, ledgerRes, shippingRes]) {
    if (r.error) throw new Error(`Failed to read refund facts for ${o.order_number}: ${r.error.message}`)
  }

  const slugs = Array.from(new Set((itemsRes.data ?? []).map((i) => i.product_id as string)))
  const categoryBySlug = new Map<string, string>()
  if (slugs.length > 0) {
    const { data: products, error: productsError } = await admin
      .from('products')
      .select('slug, categories(slug)')
      .in('slug', slugs)
    if (productsError) throw new Error(`Failed to read products: ${productsError.message}`)
    for (const p of products ?? []) {
      const cat = (p as { categories?: { slug?: string } | { slug?: string }[] | null }).categories
      const slug = Array.isArray(cat) ? cat[0]?.slug : cat?.slug
      if (slug) categoryBySlug.set(p.slug as string, slug)
    }
  }

  const claimed = new Map<string, number>()
  for (const row of claimsRes.data ?? []) {
    const rr = (row as { return_requests: { id: string } | { id: string }[] }).return_requests
    const caseId = Array.isArray(rr) ? rr[0]?.id : rr?.id
    if (excludeCaseId && caseId === excludeCaseId) continue
    const qty = Number(row.qty_approved ?? row.qty_requested) || 0
    claimed.set(row.order_item_id as string, (claimed.get(row.order_item_id as string) ?? 0) + qty)
  }

  let committedMinor = 0
  let inFlight = false
  for (const t of ledgerRes.data ?? []) {
    const status = t.status as (typeof COMMITTED_STATUSES)[number]
    if (COMMITTED_STATUSES.includes(status)) committedMinor += Number(t.amount_minor)
    if (IN_FLIGHT_STATUSES.includes(status)) inFlight = true
  }

  return {
    id: orderId,
    number: o.order_number as string,
    userId: (o.user_id as string | null) ?? undefined,
    email: (o.customer_email as string | null) ?? undefined,
    customerName: o.customer_name as string,
    status: o.status as string,
    paymentStatus: (o.payment_status as string | null) ?? undefined,
    paymentProvider: (o.payment_provider as string | null) ?? undefined,
    paymentId: (o.payment_id as string | null) ?? undefined,
    paymentCurrency: (o.payment_currency as string | null) ?? undefined,
    paymentAmount: o.payment_amount === null || o.payment_amount === undefined ? undefined : Number(o.payment_amount),
    createdAt: Date.parse(o.created_at as string),
    shippedAt: ms(o.shipped_at),
    deliveredAt: ms(o.delivered_at),
    expectedDeliveryBy: ms(o.delivery_estimate_max),
    trackingNumber: (o.tracking_number as string | null) ?? undefined,
    courierName: (o.courier_name as string | null) ?? undefined,
    subtotalMinor: toMinor(o.subtotal as string | number),
    discountMinor: toMinor(o.discount as string | number),
    shippingMinor: toMinor(o.shipping_cost as string | number),
    taxMinor: toMinor(o.tax as string | number),
    totalMinor: toMinor(o.total as string | number),
    refundedMinor: toMinor(o.refunded_amount as string | number),
    committedMinor,
    inFlight,
    shippingAlreadyRefunded: (shippingRes.data ?? []).some((c) => c.id !== excludeCaseId),
    lines: (itemsRes.data ?? []).map((i) => ({
      orderItemId: i.id as string,
      productSlug: i.product_id as string,
      categorySlug: categoryBySlug.get(i.product_id as string),
      name: i.name as string,
      image: (i.image as string | null) ?? undefined,
      size: i.size as string,
      color: i.color as string,
      qty: Number(i.qty),
      unitPriceMinor: toMinor(i.unit_price as string | number),
      claimedQty: claimed.get(i.id as string) ?? 0,
    })),
  }
}

export function toEligibilityOrder(f: RefundOrderFacts): EligibilityOrder {
  return {
    paymentStatus: f.paymentStatus,
    status: f.status,
    createdAt: f.createdAt,
    shippedAt: f.shippedAt,
    deliveredAt: f.deliveredAt,
    expectedDeliveryBy: f.expectedDeliveryBy,
    trackingNumber: f.trackingNumber,
    totalMinor: f.totalMinor,
    committedRefundMinor: f.committedMinor,
    lines: f.lines.map((l) => ({
      orderItemId: l.orderItemId,
      productSlug: l.productSlug,
      categorySlug: l.categorySlug,
      name: l.name,
      qty: l.qty,
      claimedQty: l.claimedQty,
    })),
  }
}

export function toCalcOrder(f: RefundOrderFacts): CalcOrder {
  return {
    subtotalMinor: f.subtotalMinor,
    discountMinor: f.discountMinor,
    shippingMinor: f.shippingMinor,
    taxMinor: f.taxMinor,
    totalMinor: f.totalMinor,
    lines: f.lines.map((l) => ({ orderItemId: l.orderItemId, qty: l.qty, unitPriceMinor: l.unitPriceMinor })),
  }
}

export function claimedElsewhere(f: RefundOrderFacts): Record<string, number> {
  return Object.fromEntries(f.lines.map((l) => [l.orderItemId, l.claimedQty]))
}
