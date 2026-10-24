import { NextResponse, type NextRequest } from 'next/server'
import { STATUS_CONFLICT, cancelOrder, deleteOrder, getOrderById, setOrderStatus } from '@/lib/server/orders-store'
import { cancelPaymentIntent, isStripeConfigured } from '@/lib/server/stripe'
import { cancellationRefusal } from '@/lib/payment-state'
import { notifyStatusUpdate } from '@/lib/server/notifications'
import { ORDER_STATUSES, type Order, type OrderStatus } from '@/lib/types'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { notifyOrderStatus } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: OrderStatus[] = ORDER_STATUSES

// Auth is already enforced by middleware.ts for every /api/admin/* path.

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied
  const body = await readJsonObject<{ status?: string; expectedStatus?: unknown; trackingNumber?: unknown; courierName?: unknown }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.status || !VALID_STATUSES.includes(body.status as OrderStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  // Optional: the status the admin was looking at (see setOrderStatus).
  if (body.expectedStatus !== undefined && !VALID_STATUSES.includes(body.expectedStatus as OrderStatus)) {
    return NextResponse.json({ error: 'Invalid expected status' }, { status: 400 })
  }
  const expectedStatus = body.expectedStatus as OrderStatus | undefined
  const conflict = () =>
    NextResponse.json(
      { error: 'Статус заказа уже изменили (другой сотрудник или оплата) — обновите страницу и проверьте.', code: 'STATUS_CONFLICT' },
      { status: 409 },
    )

  // `undefined` leaves the stored tracking number untouched; an explicit empty
  // string clears it. Anything non-string is rejected rather than coerced.
  let trackingNumber: string | null | undefined
  if (body.trackingNumber !== undefined) {
    if (typeof body.trackingNumber !== 'string') {
      return NextResponse.json({ error: 'Invalid tracking number' }, { status: 400 })
    }
    const trimmed = body.trackingNumber.trim()
    if (trimmed.length > 0 && (trimmed.length < 4 || trimmed.length > 64)) {
      // Mirrors the CHECK constraint on orders.tracking_number, so a bad value
      // is a clean 400 instead of a database error surfacing as a 500.
      return NextResponse.json(
        { error: 'Tracking number must be 4-64 characters' },
        { status: 400 },
      )
    }
    trackingNumber = trimmed.length > 0 ? trimmed : null
  }

  // Same undefined/empty-string contract as trackingNumber: undefined leaves
  // the stored value alone, "" clears it.
  let courierName: string | null | undefined
  if (body.courierName !== undefined) {
    if (typeof body.courierName !== 'string') {
      return NextResponse.json({ error: 'Invalid courier name' }, { status: 400 })
    }
    const trimmed = body.courierName.trim()
    if (trimmed.length > 60) {
      return NextResponse.json({ error: 'Courier name too long' }, { status: 400 })
    }
    courierName = trimmed.length > 0 ? trimmed : null
  }

  // Cancelling an order nobody has paid for goes through the same path as
  // the customer's own cancel button: its open PaymentIntent is cancelled
  // first, then the order, its units go back on sale, its promo-code use is
  // returned and its payment status says 'expired'. Setting the status alone
  // left the units reserved for an order that would never ship. A paid order
  // set to "cancelled" keeps the plain status change: its money and units
  // follow the refund (lib/server/refund-order.ts).
  let updated: Order | null
  const current = body.status === 'cancelled' ? await getOrderById(params.id) : null
  if (current && expectedStatus && current.status !== expectedStatus) return conflict()
  if (current && current.status !== 'cancelled' && cancellationRefusal(current) === null) {
    if (current.paymentProvider === 'stripe' && current.paymentId && isStripeConfigured()) {
      const intent = await cancelPaymentIntent(current.paymentId)
      if (!intent.ok) {
        return NextResponse.json(
          {
            error:
              intent.reason === 'captured'
                ? 'Оплата по этому заказу уже прошла — оформите возврат вместо отмены.'
                : 'Не удалось отменить платёж в Stripe, попробуйте ещё раз.',
          },
          { status: 409 },
        )
      }
    }
    const result = await cancelOrder(params.id)
    if (result.conflict) {
      return NextResponse.json({ error: 'Статус заказа изменился — обновите страницу.' }, { status: 409 })
    }
    updated = result.order
  } else {
    const result = await setOrderStatus(params.id, body.status as OrderStatus, trackingNumber, courierName, expectedStatus)
    if (result === STATUS_CONFLICT) return conflict()
    updated = result
  }
  if (!updated) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Tell the customer their order moved. Only for account-bound orders — a
  // guest order has no user_id and therefore no feed to deliver into.
  //
  // Fires after the status is committed, and its failure is swallowed inside
  // notifyStatusUpdate: the admin's action succeeded, and reporting an error
  // here would make staff retry a status change that already applied.
  if (updated.userId) {
    await notifyStatusUpdate({
      userId: updated.userId,
      orderId: updated.id,
      status: updated.status,
      trackingNumber: updated.trackingNumber,
    })
  }

  await notifyOrderStatus(updated, 'admin')

  return NextResponse.json({ order: updated })
}

export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied
  const removed = await deleteOrder(params.id)
  if (removed === 'not_found') {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (removed === 'has_payment') {
    // The record of a payment is kept (lib/server/orders-store.ts, deleteOrder).
    return NextResponse.json(
      { error: 'Оплаченный заказ нельзя удалить: отмените его и оформите возврат.' },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true })
}
