import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById, setOrderPaymentSession } from '@/lib/server/orders-store'
import { createPaymentIntent, isStripeConfigured } from '@/lib/server/stripe'
import { resolveStripeCustomerId } from '@/lib/server/stripe-customer'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Creates a PaymentIntent for an existing order and returns its client secret,
 * so the browser can render an embedded PaymentElement.
 *
 * Replaces the previous /checkout route, which minted a hosted Checkout
 * Session and returned a redirect URL.
 *
 * The guarantees are the same ones the old route had, and they matter more
 * here because the client secret is returned to the browser:
 *
 *  - The amount is rebuilt from the STORED order. Nothing about the price
 *    comes from the request body.
 *  - Access is gated on the order's lookup token — the per-order secret the
 *    customer's own browser holds.
 *  - "Order not found" covers both a missing order and a bad token, so the
 *    endpoint cannot be used to enumerate order ids.
 *
 * A client secret authorises confirming this one payment and reading its
 * status. It is not a credential for the Stripe account, and it is useless
 * without the publishable key it was minted against — but it is still
 * per-order, which is why the token check above is not optional.
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Оплата картой временно недоступна' }, { status: 503 })
  }

  let body: { orderId?: string; token?: string; saveCard?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { orderId, token } = body
  if (!orderId || !token) {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }

  const order = await getOrderById(orderId)
  if (!order || !order.lookupToken || order.lookupToken !== token) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (order.paymentStatus === 'paid') {
    return NextResponse.json({ error: 'Заказ уже оплачен' }, { status: 409 })
  }

  try {
    // The Stripe Customer that owns saved cards. Resolved from the SESSION,
    // never from the request body — a client-supplied customer id would let
    // anyone attach their payment to, or read cards from, another account.
    let customerId: string | undefined
    const user = await getCurrentUser()
    if (user && order.userId && order.userId === user.id) {
      try {
        customerId = await resolveStripeCustomerId({
          id: user.id,
          email: user.email ?? order.customer.email,
          name: order.customer.name,
        })
      } catch {
        // Saved cards are a convenience; the payment must still work without.
        customerId = undefined
      }
    }

    const intent = await createPaymentIntent(order, {
      customerId,
      saveCard: Boolean(body.saveCard) && Boolean(customerId),
    })

    if (!intent.client_secret) {
      return NextResponse.json({ error: 'Stripe returned no client secret' }, { status: 502 })
    }

    // Store the PaymentIntent id against the order BEFORE the browser can
    // confirm it. The webhook finds the order by payment_id, so a fast
    // confirmation must not arrive before the order knows its own intent id.
    await setOrderPaymentSession(order.id, {
      payment: order.payment,
      paymentStatus: 'pending_payment',
      paymentProvider: 'stripe',
      paymentId: intent.id,
      paymentCurrency: intent.currency.toUpperCase(),
      paymentAmount: order.total,
      paymentAddress: undefined,
    })

    return NextResponse.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stripe error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
