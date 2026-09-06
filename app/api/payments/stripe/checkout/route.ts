import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById, setOrderPaymentSession } from '@/lib/server/orders-store'
import { createCheckoutSession, isStripeConfigured } from '@/lib/server/stripe'
import { resolveStripeCustomerId } from '@/lib/server/stripe-customer'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Opens a Stripe Checkout session for an order that already exists.
 *
 * Mirrors the crypto "resume" endpoint on purpose, and for the same reasons:
 *
 *  - The amount is rebuilt from the STORED order. Nothing about the price
 *    comes from the request body, so a tampered client cannot pay CHF 1 for a
 *    CHF 900 order.
 *  - Access is gated on the order's lookup token — the per-order secret the
 *    customer's own browser holds. Without it an order can be neither read
 *    nor paid.
 *  - "Order not found" is returned for both a missing order and a bad token,
 *    so the endpoint cannot be used to enumerate which order ids exist.
 *
 * This same route serves both the initial checkout and "pay later" from the
 * account page; there is nothing stateful about the first case.
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Оплата картой временно недоступна' },
      { status: 503 },
    )
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
    // A Stripe Customer is what owns saved cards. Resolved from the SESSION,
    // never from the request body — a client-supplied customer id would let
    // anyone attach their payment to, or read cards from, another account.
    // Guests get no customer and therefore no saved cards, which is correct:
    // there is no account for a card to belong to.
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
        // Saved cards are a convenience. If the customer lookup fails the
        // payment must still go through, just without the save option.
        customerId = undefined
      }
    }

    const session = await createCheckoutSession(order, {
      customerId,
      saveCard: Boolean(body.saveCard) && Boolean(customerId),
    })
    if (!session.url) {
      return NextResponse.json({ error: 'Stripe returned no checkout URL' }, { status: 502 })
    }

    // Record the session against the order BEFORE handing the customer over.
    // The webhook looks the order up by payment_id, so if this write were left
    // until after the redirect a fast payment could arrive before the order
    // knew its own session id.
    await setOrderPaymentSession(order.id, {
      payment: order.payment,
      paymentStatus: 'pending_payment',
      paymentProvider: 'stripe',
      paymentId: session.id,
      paymentCurrency: (session.currency ?? 'chf').toUpperCase(),
      paymentAmount: order.total,
      paymentAddress: undefined,
    })

    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stripe error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
