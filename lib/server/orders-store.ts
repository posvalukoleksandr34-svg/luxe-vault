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

import { createAdminClient } from '@/lib/supabase/admin'
import type { CartItem, Order, OrderStatus, PaymentStatus } from '@/lib/types'

/** Columns of `orders` plus its nested items, as selected below. */
const ORDER_SELECT = `
  id, order_number, created_at, user_id, lookup_token, status, tracking_number,
  processing_at, shipped_at, delivered_at, cancelled_at,
  customer_name, customer_email, customer_phone,
  address_line, street, postal_code, city, country,
  subtotal, discount, total, promo, payment,
  payment_status, payment_provider, payment_id, payment_currency,
  payment_address, payment_amount,
  order_items (
    id, product_id, name, image, unit_price, size, color, qty
  )
`

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
    total: num(row.total as string),
    promo: (row.promo as string | null) ?? undefined,
    payment: row.payment as string,
    status: row.status as OrderStatus,
    trackingNumber: (row.tracking_number as string | null) ?? undefined,
    processingAt: ms(row.processing_at as string | null),
    shippedAt: ms(row.shipped_at as string | null),
    deliveredAt: ms(row.delivered_at as string | null),
    cancelledAt: ms(row.cancelled_at as string | null),
    lookupToken: (row.lookup_token as string | null) ?? undefined,
    paymentStatus: (row.payment_status as PaymentStatus | null) ?? undefined,
    paymentProvider: (row.payment_provider as 'nowpayments' | null) ?? undefined,
    paymentId: (row.payment_id as string | null) ?? undefined,
    paymentCurrency: (row.payment_currency as string | null) ?? undefined,
    paymentAddress: (row.payment_address as string | null) ?? undefined,
    paymentAmount:
      row.payment_amount == null ? undefined : num(row.payment_amount as string),
  }
}

export async function readOrders(): Promise<Order[]> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .select(ORDER_SELECT)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to read orders: ${error.message}`)
  return (data ?? []).map(rowToOrder)
}

export async function addOrder(order: Order): Promise<void> {
  const supabase = createAdminClient()

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
      total: order.total,
      promo: order.promo ?? null,
      payment: order.payment,
      payment_status: order.paymentStatus ?? null,
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
    .select(ORDER_SELECT)
    .eq('order_number', id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load order: ${error.message}`)
  return data ? rowToOrder(data) : null
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
    .select(ORDER_SELECT)
    .in(
      'order_number',
      credentials.map((c) => c.id),
    )

  if (error) throw new Error(`Failed to look up orders: ${error.message}`)

  // The token comparison stays in application code, exactly as before: the
  // query fetches candidates by id, and only rows whose token matches the
  // caller's are returned.
  const wanted = new Map(credentials.map((c) => [c.id, c.token]))
  return (data ?? [])
    .map(rowToOrder)
    .filter((o) => Boolean(o.lookupToken) && wanted.get(o.id) === o.lookupToken)
}

/** Every order belonging to a signed-in customer. */
export async function getOrdersByUserId(userId: string): Promise<Order[]> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .select(ORDER_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to load orders: ${error.message}`)
  return (data ?? []).map(rowToOrder)
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
    .select(ORDER_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to attach payment session: ${error.message}`)
  return data ? rowToOrder(data) : null
}

export async function findOrderByPaymentId(paymentId: string): Promise<Order | null> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .select(ORDER_SELECT)
    .eq('payment_id', paymentId)
    .maybeSingle()

  if (error) throw new Error(`Failed to find order by payment id: ${error.message}`)
  return data ? rowToOrder(data) : null
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
    .select(ORDER_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to set payment status: ${error.message}`)
  return data ? rowToOrder(data) : null
}

export async function setOrderStatus(
  id: string,
  status: OrderStatus,
  trackingNumber?: string | null,
): Promise<Order | null> {
  // processing_at / shipped_at / delivered_at / cancelled_at are stamped by the
  // orders_stamp_status trigger, so the timeline cannot drift from the status.
  const patch: Record<string, unknown> = { status }
  if (trackingNumber !== undefined) {
    patch.tracking_number = trackingNumber?.trim() || null
  }

  const { data, error } = await createAdminClient()
    .from('orders')
    .update(patch)
    .eq('order_number', id)
    .select(ORDER_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to set order status: ${error.message}`)
  return data ? rowToOrder(data) : null
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
