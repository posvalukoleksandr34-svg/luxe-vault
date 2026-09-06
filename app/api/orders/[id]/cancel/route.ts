import { NextResponse, type NextRequest } from 'next/server'
import { cancelOrder, getOrderById } from '@/lib/server/orders-store'
import { cancelPaymentIntent, isStripeConfigured } from '@/lib/server/stripe'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Customer-initiated cancellation of an UNPAID order.
 *
 * Safe to self-serve: cancelling an order that has taken no money costs the
 * shop nothing, and the alternative — emailing support — leaves dead
 * `pending_payment` rows accumulating forever.
 *
 * Two gates, both required:
 *   1. The order must belong to the signed-in user. Checked against
 *      `order.userId`, never against anything in the request.
 *   2. The order must not be paid. A paid order needs a refund, which is an
 *      admin action; see /api/admin/orders/[id]/refund.
 *
 * ORDER OF OPERATIONS MATTERS. Stripe is cancelled FIRST, and the database row
 * is only flipped if that succeeds. The reverse order would leave a window
 * where the shop believes the order is dead while its PaymentIntent is still
 * confirmable — and the customer gets charged for it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { reason?: string } = {}
  try {
    body = await request.json()
  } catch {
    // Reason is optional; an empty body is fine.
  }

  const order = await getOrderById(params.id)
  // Same response for "no such order" and "not yours", so the endpoint cannot
  // be used to discover which order ids exist.
  if (!order || order.userId !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.status === 'cancelled') {
    return NextResponse.json({ order, alreadyCancelled: true })
  }
  if (order.paymentStatus === 'paid') {
    return NextResponse.json(
      { error: 'Оплаченный заказ нельзя отменить — оформите возврат.' },
      { status: 409 },
    )
  }
  // A payment mid-flight must settle or fail before the order can be resolved,
  // or we would cancel a row that is about to be marked paid.
  if (order.paymentStatus === 'confirming') {
    return NextResponse.json(
      { error: 'Платёж обрабатывается. Повторите попытку через несколько минут.' },
      { status: 409 },
    )
  }

  // Kill the PaymentIntent first — see the note above.
  if (order.paymentProvider === 'stripe' && order.paymentId && isStripeConfigured()) {
    const result = await cancelPaymentIntent(order.paymentId)
    if (!result.ok) {
      if (result.reason === 'captured') {
        // Stripe knows about money our row did not. Refuse, and let the
        // webhook reconcile the payment status rather than guessing here.
        return NextResponse.json(
          { error: 'Платёж уже прошёл. Оформите возврат вместо отмены.' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: result.message }, { status: 502 })
    }
  }

  const { order: cancelled, conflict } = await cancelOrder(params.id, body.reason)
  if (conflict) {
    // The guarded UPDATE rejected it — something changed underneath us.
    return NextResponse.json(
      { error: 'Статус заказа изменился. Обновите страницу.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ order: cancelled })
}
