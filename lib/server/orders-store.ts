// Server-only persistence for orders, backed by Postgres (Supabase).
//
// Replaces the previous JSON-file store. Every write goes through the
// service-role client, which bypasses RLS — so totals, fulfilment status and
// tracking numbers are server-authored and can never be set from a browser.
//
// Naming note: at the application level `Order.id` remains the human-readable
// LV-XXXXXX reference, which is `orders.order_number` in Postgres. The uuid
// primary key is an internal detail that foreign keys hang off; keeping the
// public id stable meant the API routes, the client-side order registry and
// the admin panel did not have to change.
import 'server-only'

import { sendOrderStatusEmail } from '@/lib/server/emails/send-lifecycle'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CartItem, Order, OrderStatus, PaymentStatus, ReturnStatus } from '@/lib/types'

/**
 * Columns added by 0014/0015. Requested only once the database actually has
 * them.
 *
 * PostgREST rejects the whole SELECT when one column is unknown, so naming
 * these unconditionally would make every order read fail — the order page, the
 * account drawer, the admin, the webhooks — on any deployment where the code
 * landed before the migration. `MONEY_COLUMNS` is spliced in after a one-time
 * probe instead; see resolveOrderSelect() below.
 *
 * Delete the probe and inline these once 0015 is applied everywhere.
 */
const MONEY_COLUMNS = 'shipping_cost, tax, coupon_id,'

let orderSelectCache: string | null = null

async function resolveOrderSelect(): Promise<string> {
  if (orderSelectCache) return orderSelectCache

  const { error } = await createAdminClient()
    .from('orders')
    .select('shipping_cost, tax, coupon_id')
    .limit(1)

  if (error) {
    console.error(
      '[orders] shipping_cost/tax/coupon_id are missing — orders will read ' +
        'without them. Apply migrations 0014 and 0015.',
    )
    orderSelectCache = ORDER_SELECT_TEMPLATE.replace(MONEY_COLUMNS, '')
  } else {
    orderSelectCache = ORDER_SELECT_TEMPLATE
  }

  return orderSelectCache
}

/** Columns of `orders` plus its nested items, as selected below. */
const ORDER_SELECT_TEMPLATE = `
  id, order_number, created_at, user_id, lookup_token, status, tracking_number,
  processing_at, shipped_at, delivered_at, cancelled_at,
  customer_name, customer_email, customer_phone,
  address_line, street, postal_code, city, country,
  subtotal, discount, ${MONEY_COLUMNS} total, promo, payment,
  payment_status, payment_provider, payment_id, payment_currency,
  payment_address, payment_amount,
  cancelled_reason, refunded_amount, refunded_at, stripe_refund_id,
  return_status, return_reason, return_requested_at,
  receipt_sent_at,
  courier_name, shipping_type, delivery_estimate_min, delivery_estimate_max,
  order_items (
    id, product_id, name, image, unit_price, size, color, qty
  )
`

/** PostgREST cannot infer row types from a select string built at runtime.
 *  rowToOrder() reads every field defensively, so the cast is safe. */
type OrderRow = Record<string, unknown>
const asRows = (d: unknown): OrderRow[] => (d ?? []) as OrderRow[]
const asRow = (d: unknown): OrderRow => d as OrderRow

type ItemRow = {
  id: string
  product_id: string
  name: string
  image: string | null
  unit_price: string | number
  size: string
  color: string
  qty: number
}

/**
 * numeric columns arrive from PostgREST as strings, not numbers. Letting one
 * reach the UI unconverted makes `total.toFixed()` throw at runtime.
 */
const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : parseFloat(v)

const ms = (v: string | null): number | undefined =>
  v ? new Date(v).getTime() : undefined

function rowToOrder(row: Record<string, unknown>): Order {
  const items = ((row.order_items as ItemRow[] | null) ?? []).map(
    (i): CartItem => ({
      key: i.id,
      productId: i.product_id,
      name: i.name,
      image: i.image ?? '',
      price: num(i.unit_price),
      size: i.size,
      color: i.color,
      qty: i.qty,
    }),
  )

  return {
    id: row.order_number as string,
    createdAt: new Date(row.created_at as string).getTime(),
    userId: (row.user_id as string | null) ?? undefined,
    customer: {
      name: row.customer_name as string,
      phone: row.customer_phone as string,
      address: row.address_line as string,
      email: (row.customer_email as string | null) ?? undefined,
      street: (row.street as string | null) ?? undefined,
      postalCode: (row.postal_code as string | null) ?? undefined,
      city: (row.city as string | null) ?? undefined,
      country: (row.country as string | null) ?? undefined,
    },
    items,
    subtotal: num(row.subtotal as string),
    discount: num(row.discount as string),
    shippingCost: num(row.shipping_cost as string),
    tax: num(row.tax as string),
    total: num(row.total as string),
    promo: (row.promo as string | null) ?? undefined,
    couponId: (row.coupon_id as string | null) ?? undefined,
    payment: row.payment as string,
    status: row.status as OrderStatus,
    trackingNumber: (row.tracking_number as string | null) ?? undefined,
    processingAt: ms(row.processing_at as string | null),
    shippedAt: ms(row.shipped_at as string | null),
    deliveredAt: ms(row.delivered_at as string | null),
    cancelledAt: ms(row.cancelled_at as string | null),
    lookupToken: (row.lookup_token as string | null) ?? undefined,
    paymentStatus: (row.payment_status as PaymentStatus | null) ?? undefined,
    paymentProvider: (row.payment_provider as 'nowpayments' | 'stripe' | null) ?? undefined,
    paymentId: (row.payment_id as string | null) ?? undefined,
    paymentCurrency: (row.payment_currency as string | null) ?? undefined,
    paymentAddress: (row.payment_address as string | null) ?? undefined,
    paymentAmount:
      row.payment_amount == null ? undefined : num(row.payment_amount as string),
    returnStatus: (row.return_status as ReturnStatus | null) ?? undefined,
    returnReason: (row.return_reason as string | null) ?? undefined,
    returnRequestedAt: row.return_requested_at
      ? Date.parse(row.return_requested_at as string)
      : undefined,
    cancelledReason: (row.cancelled_reason as string | null) ?? undefined,
    // Postgres numerics arrive as strings over PostgREST; num() is what stops
    // "10.00" being concatenated instead of added downstream.
    refundedAmount:
      row.refunded_amount == null ? undefined : num(row.refunded_amount as string),
    refundedAt: row.refunded_at ? Date.parse(row.refunded_at as string) : undefined,
    stripeRefundId: (row.stripe_refund_id as string | null) ?? undefined,
    receiptSentAt: row.receipt_sent_at ? Date.parse(row.receipt_sent_at as string) : undefined,
    courierName: (row.courier_name as string | null) ?? undefined,
    shippingType: (row.shipping_type as 'standard' | 'express' | null) ?? undefined,
    deliveryEstimateMin: row.delivery_estimate_min
      ? Date.parse(row.delivery_estimate_min as string)
      : undefined,
    deliveryEstimateMax: row.delivery_estimate_max
      ? Date.parse(row.delivery_estimate_max as string)
      : undefined,
  }
}

export async function readOrders(): Promise<Order[]> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .select(await resolveOrderSelect())
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to read orders: ${error.message}`)
  return asRows(data).map(rowToOrder)
}

/**
 * Raised when a tracked variant cannot cover the quantity ordered.
 *
 * A distinct class rather than a string match, so the API route can answer 409
 * with the customer's own words instead of a 500 — running out of stock is a
 * normal outcome, not a server fault.
 */
export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsufficientStockError'
  }
}

export async function addOrder(order: Order): Promise<void> {
  const supabase = createAdminClient()

  // One transaction for the order, its items and the stock decrement. See
  // migration 0012 for why the guarantee has to live in the database: two
  // checkouts for the last item both read `stock: 1` from here and both
  // succeed, no matter how carefully this function is written.
  const { data: rpcId, error: rpcError } = await supabase.rpc('place_order', {
    p_order: {
      order_number: order.id,
      user_id: order.userId ?? '',
      lookup_token: order.lookupToken,
      status: order.status,
      customer_name: order.customer.name,
      customer_email: order.customer.email ?? '',
      customer_phone: order.customer.phone,
      address_line: order.customer.address,
      street: order.customer.street ?? '',
      postal_code: order.customer.postalCode ?? '',
      city: order.customer.city ?? '',
      country: order.customer.country ?? '',
      subtotal: order.subtotal,
      discount: order.discount,
      shipping_cost: order.shippingCost ?? 0,
      tax: order.tax ?? 0,
      total: order.total,
      promo: order.promo ?? '',
      coupon_id: order.couponId ?? '',
      payment: order.payment,
      payment_status: order.paymentStatus ?? '',
      shipping_type: order.shippingType ?? 'standard',
      delivery_estimate_min: order.deliveryEstimateMin
        ? new Date(order.deliveryEstimateMin).toISOString()
        : '',
      delivery_estimate_max: order.deliveryEstimateMax
        ? new Date(order.deliveryEstimateMax).toISOString()
        : '',
    },
    p_items: order.items.map((i) => ({
      product_id: i.productId,
      name: i.name,
      image: i.image || '',
      unit_price: i.price,
      size: i.size,
      color: i.color,
      qty: i.qty,
    })),
  })

  if (!rpcError && rpcId) return

  if (rpcError) {
    if (rpcError.message.includes('INSUFFICIENT_STOCK')) {
      throw new InsufficientStockError(
        rpcError.message.replace(/^.*INSUFFICIENT_STOCK:\s*/, '').trim(),
      )
    }

    // The function does not exist yet — the database is still on 0011. Fall
    // through to the pre-0012 path so checkout keeps working, but say loudly
    // that nothing is guarding against overselling.
    const missingFunction =
      rpcError.code === 'PGRST202' || /place_order/i.test(rpcError.message)

    if (!missingFunction) {
      throw new Error(`Failed to create order: ${rpcError.message}`)
    }

    console.error(
      '[orders] place_order() is missing — orders are being created WITHOUT ' +
        'the oversell guard. Apply supabase/migrations/0012_inventory.sql.',
    )
  }

  await addOrderLegacy(order, supabase)
}

/**
 * Pre-0012 order creation: two separate inserts and a compensating delete.
 *
 * Kept only so a deploy that lands before the migration still takes orders.
 * It cannot decrement stock, and its "transaction" is a manual cleanup that
 * does nothing if the process dies between the two statements — which is
 * precisely what place_order() exists to fix. Delete this once 0012 is applied
 * in every environment.
 */
async function addOrderLegacy(
  order: Order,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const { data, error } = await supabase
    .from('orders')
    .insert({
      order_number: order.id,
      user_id: order.userId ?? null,
      lookup_token: order.lookupToken,
      status: order.status,
      customer_name: order.customer.name,
      customer_email: order.customer.email ?? null,
      customer_phone: order.customer.phone,
      address_line: order.customer.address,
      street: order.customer.street ?? null,
      postal_code: order.customer.postalCode ?? null,
      city: order.customer.city ?? null,
      country: order.customer.country ?? null,
      subtotal: order.subtotal,
      discount: order.discount,
      shipping_cost: order.shippingCost ?? 0,
      tax: order.tax ?? 0,
      total: order.total,
      promo: order.promo ?? null,
      coupon_id: order.couponId ?? null,
      payment: order.payment,
      payment_status: order.paymentStatus ?? null,
      // Quoted at purchase and frozen. Stored as ISO so Postgres keeps them
      // as timestamptz rather than re-deriving anything.
      shipping_type: order.shippingType ?? 'standard',
      delivery_estimate_min: order.deliveryEstimateMin
        ? new Date(order.deliveryEstimateMin).toISOString()
        : null,
      delivery_estimate_max: order.deliveryEstimateMax
        ? new Date(order.deliveryEstimateMax).toISOString()
        : null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create order: ${error.message}`)

  if (order.items.length > 0) {
    const { error: itemsError } = await supabase.from('order_items').insert(
      order.items.map((i) => ({
        order_id: data.id,
        product_id: i.productId,
        name: i.name,
        image: i.image || null,
        unit_price: i.price,
        size: i.size,
        color: i.color,
        qty: i.qty,
      })),
    )
    if (itemsError) {
      // These are two separate statements, so there is no transaction to roll
      // back. An order whose items failed to insert would be a phantom the
      // customer could pay for but nobody could ship — delete it and surface
      // the failure rather than leave that behind.
      await supabase.from('orders').delete().eq('id', data.id)
      throw new Error(`Failed to create order items: ${itemsError.message}`)
    }
  }
}

export async function getOrderById(id: string): Promise<Order | null> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .select(await resolveOrderSelect())
    .eq('order_number', id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load order: ${error.message}`)
  return data ? rowToOrder(asRow(data)) : null
}

/**
 * Looks up several orders at once, returning only those whose lookup token
 * matches the one supplied by the caller. Used by a guest browser to re-read
 * the orders it placed without any server-side account.
 */
export async function getOrdersByCredentials(
  credentials: { id: string; token: string }[],
): Promise<Order[]> {
  if (credentials.length === 0) return []

  const { data, error } = await createAdminClient()
    .from('orders')
    .select(await resolveOrderSelect())
    .in(
      'order_number',
      credentials.map((c) => c.id),
    )

  if (error) throw new Error(`Failed to look up orders: ${error.message}`)

  // The token comparison stays in application code, exactly as before: the
  // query fetches candidates by id, and only rows whose token matches the
  // caller's are returned.
  const wanted = new Map(credentials.map((c) => [c.id, c.token]))
  return asRows(data)
    .map(rowToOrder)
    .filter((o) => Boolean(o.lookupToken) && wanted.get(o.id) === o.lookupToken)
}

/** Every order belonging to a signed-in customer. */
export async function getOrdersByUserId(userId: string): Promise<Order[]> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .select(await resolveOrderSelect())
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to load orders: ${error.message}`)
  return asRows(data).map(rowToOrder)
}

/**
 * Attaches a freshly created payment-gateway session to an existing order,
 * used both when the order is first placed and when the customer comes back
 * to pay it later.
 */
export async function setOrderPaymentSession(
  id: string,
  session: Pick<
    Order,
    | 'paymentStatus'
    | 'paymentProvider'
    | 'paymentId'
    | 'paymentCurrency'
    | 'paymentAddress'
    | 'paymentAmount'
    | 'payment'
  >,
): Promise<Order | null> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .update({
      payment: session.payment,
      payment_status: session.paymentStatus ?? null,
      payment_provider: session.paymentProvider ?? null,
      payment_id: session.paymentId ?? null,
      payment_currency: session.paymentCurrency ?? null,
      payment_address: session.paymentAddress ?? null,
      payment_amount: session.paymentAmount ?? null,
    })
    .eq('order_number', id)
    .select(await resolveOrderSelect())
    .maybeSingle()

  if (error) throw new Error(`Failed to attach payment session: ${error.message}`)
  return data ? rowToOrder(asRow(data)) : null
}

export async function findOrderByPaymentId(paymentId: string): Promise<Order | null> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .select(await resolveOrderSelect())
    .eq('payment_id', paymentId)
    .maybeSingle()

  if (error) throw new Error(`Failed to find order by payment id: ${error.message}`)
  return data ? rowToOrder(asRow(data)) : null
}

/**
 * Advances a crypto order's payment lifecycle. Only ever called from the
 * signature-verified webhook handler — never trust a client-supplied payment
 * status.
 */
export async function setPaymentStatus(
  paymentId: string,
  paymentStatus: PaymentStatus,
): Promise<Order | null> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .update({ payment_status: paymentStatus })
    .eq('payment_id', paymentId)
    .select(await resolveOrderSelect())
    .maybeSingle()

  if (error) throw new Error(`Failed to set payment status: ${error.message}`)
  return data ? rowToOrder(asRow(data)) : null
}

export async function setOrderStatus(
  id: string,
  status: OrderStatus,
  trackingNumber?: string | null,
  courierName?: string | null,
): Promise<Order | null> {
  // processing_at / shipped_at / delivered_at / cancelled_at are stamped by the
  // orders_stamp_status trigger, so the timeline cannot drift from the status.
  const patch: Record<string, unknown> = { status }
  if (trackingNumber !== undefined) {
    patch.tracking_number = trackingNumber?.trim() || null
  }
  // A tracking number without a carrier renders as a bare string with no
  // link, so the two are set together.
  if (courierName !== undefined) {
    patch.courier_name = courierName?.trim() || null
  }

  const { data, error } = await createAdminClient()
    .from('orders')
    .update(patch)
    .eq('order_number', id)
    .select(await resolveOrderSelect())
    .maybeSingle()

  if (error) throw new Error()
  if (!data) return null

  const updated = rowToOrder(asRow(data))
  // Fire-and-forget: an admin marking twenty parcels shipped should not wait
  // on twenty SMTP round trips, and a mail failure must not undo the status.
  void sendOrderStatusEmail(updated, status)
  return updated
}

/**
 * Permanently removes the order. Its `order_items` go with it via ON DELETE
 * CASCADE. Returns false if no order with that number existed.
 */
export async function deleteOrder(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .delete()
    .eq('order_number', id)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to delete order: ${error.message}`)
  return Boolean(data)
}


/**
 * Marks an order cancelled.
 *
 * Guarded on the CURRENT state in the same statement (`.eq('status', ...)` /
 * `.neq('payment_status', 'paid')`) rather than checked-then-written, so two
 * concurrent cancels — or a cancel racing the payment webhook — cannot both
 * succeed. A paid order is never cancellable here; that needs a refund.
 */
export async function cancelOrder(
  id: string,
  reason?: string,
): Promise<{ order: Order | null; conflict: boolean }> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .update({
      status: 'cancelled',
      payment_status: 'expired',
      cancelled_reason: reason?.trim() || null,
    })
    .eq('order_number', id)
    .neq('status', 'cancelled')
    .neq('payment_status', 'paid')
    .select(await resolveOrderSelect())
    .maybeSingle()

  if (error) throw new Error(`Failed to cancel order: ${error.message}`)
  // No row updated means the guards rejected it: already cancelled, or paid.
  if (!data) return { order: null, conflict: true }

  await restoreStock(id)
  const cancelled = rowToOrder(asRow(data))
  void sendOrderStatusEmail(cancelled, 'cancelled')
  return { order: cancelled, conflict: false }
}

/**
 * Returns a dead order's units to stock.
 *
 * Deliberately non-throwing. The order is already cancelled or refunded by the
 * time this runs, and failing the customer's request because the restock leg
 * had a problem would be the wrong trade — an under-counted shelf is an
 * inventory discrepancy an admin can correct, whereas a 500 on a cancellation
 * leaves the customer believing they are still committed.
 *
 * Idempotency lives in the database (orders.restocked_at), not here, so a
 * webhook delivered twice cannot credit the same units twice.
 */
async function restoreStock(orderNumber: string): Promise<void> {
  const { error } = await createAdminClient().rpc('restore_order_stock', {
    p_order_number: orderNumber,
  })

  if (error && error.code !== 'PGRST202') {
    console.error(`[orders] restock failed for ${orderNumber}:`, error.message)
  }
}

/**
 * Records a refund against an order.
 *
 * `refundedAmount` is the CUMULATIVE total, computed by the caller from
 * Stripe's ledger rather than incremented here — an increment would double
 * count if Stripe retried and the caller re-ran.
 */
export async function recordRefund(
  id: string,
  params: { refundedAmount: number; fully: boolean; refundId: string },
): Promise<Order | null> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .update({
      payment_status: params.fully ? 'refunded' : 'partially_refunded',
      // Only a full refund closes the order out. A partial refund leaves the
      // fulfilment status alone: the customer may still be receiving goods.
      ...(params.fully ? { status: 'refunded' } : {}),
      refunded_amount: params.refundedAmount,
      refunded_at: new Date().toISOString(),
      stripe_refund_id: params.refundId,
    })
    .eq('order_number', id)
    .select(await resolveOrderSelect())
    .maybeSingle()

  if (error) throw new Error(`Failed to record refund: ${error.message}`)

  // Only a full refund puts the goods back. A partial refund is usually a
  // price adjustment or one line of several, and guessing which units came
  // back would corrupt the count.
  if (!data) return null

  if (params.fully) await restoreStock(id)

  const refunded = rowToOrder(asRow(data))
  // Silence after money moves is what turns a refund into a chargeback, so
  // this goes out for partial refunds too — the amount is in the email.
  void sendOrderStatusEmail(refunded, 'refunded')
  return refunded
}


/**
 * Records a customer's refund request. Does NOT move money — it flags the
 * order for a human to review, which is the whole point: an automatic refund
 * on request would let anyone order, receive the goods and refund themselves.
 *
 * Guarded on `return_status = 'none'` in the same statement so a double-click
 * cannot file two requests.
 */
export async function requestRefund(
  id: string,
  reason?: string,
): Promise<{ order: Order | null; conflict: boolean }> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .update({
      return_status: 'requested',
      return_reason: reason?.trim() || null,
      return_requested_at: new Date().toISOString(),
    })
    .eq('order_number', id)
    .eq('return_status', 'none')
    .select(await resolveOrderSelect())
    .maybeSingle()

  if (error) throw new Error(`Failed to request refund: ${error.message}`)
  return { order: data ? rowToOrder(asRow(data)) : null, conflict: !data }
}


/**
 * Atomically claims the right to send a payment receipt for an order.
 *
 * Returns the order when THIS caller won the claim, and null when a receipt
 * was already sent (or claimed by a concurrent delivery).
 *
 * The `.is('receipt_sent_at', null)` predicate is what makes it safe. Stripe
 * delivers webhooks at least once, and two retries can be in flight at the
 * same time in two separate serverless invocations that share no memory — so
 * "check then send" would race and send two receipts. Postgres serialises the
 * conditional UPDATE, so exactly one caller sees a row back.
 *
 * Claim-before-send is deliberate: it risks losing a receipt if the send then
 * fails, which is recoverable by hand, rather than risking a customer being
 * emailed their receipt repeatedly, which is not.
 */
export async function claimReceiptSend(paymentIntentId: string): Promise<Order | null> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .update({ receipt_sent_at: new Date().toISOString() })
    .eq('payment_id', paymentIntentId)
    .is('receipt_sent_at', null)
    .select(await resolveOrderSelect())
    .maybeSingle()

  if (error) throw new Error(`Failed to claim receipt send: ${error.message}`)
  return data ? rowToOrder(asRow(data)) : null
}

/**
 * Releases a claim so a later retry can try again. Called only when the send
 * itself failed — otherwise a transient Resend outage would permanently
 * suppress the receipt.
 */
export async function releaseReceiptClaim(paymentIntentId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('orders')
    .update({ receipt_sent_at: null })
    .eq('payment_id', paymentIntentId)

  if (error) console.warn(`[receipts] failed to release claim: ${error.message}`)
}
