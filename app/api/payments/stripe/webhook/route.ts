import { NextResponse, type NextRequest } from 'next/server'
import { setPaymentStatus } from '@/lib/server/orders-store'
import { constructWebhookEvent, isStripeWebhookConfigured } from '@/lib/server/stripe'
import type { PaymentStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'
// The signature is computed over the exact request bytes, so the body must not
// be parsed, re-encoded, or transformed by any middleware before it gets here.
export const runtime = 'nodejs'

/**
 * Public by necessity — Stripe calls this directly, with no session of ours to
 * authenticate. The signature check is the entire trust boundary.
 *
 * This is the ONLY place a Stripe order is ever marked paid. The customer's
 * return to `success_url` is a navigation hint and nothing more: anyone can
 * type that URL, so treating it as proof of payment would let a customer mark
 * their own order paid by editing the address bar.
 */
export async function POST(request: NextRequest) {
  if (!isStripeWebhookConfigured()) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // .text(), never .json() — see the runtime note above.
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event
  try {
    event = constructWebhookEvent(rawBody, signature)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid signature'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Map only the events that actually change an order's money state. Stripe
  // sends dozens of others; acknowledging them with 200 and doing nothing is
  // correct, and stops Stripe retrying them forever.
  let next: PaymentStatus | null = null
  let sessionId: string | null = null

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      sessionId = session.id
      // `completed` fires when the customer finishes the flow — for a delayed
      // method that can still be unsettled, so the payment_status field is
      // what decides, not the event name.
      next = session.payment_status === 'paid' ? 'paid' : 'confirming'
      break
    }
    case 'checkout.session.async_payment_succeeded': {
      sessionId = event.data.object.id
      next = 'paid'
      break
    }
    case 'checkout.session.async_payment_failed': {
      sessionId = event.data.object.id
      next = 'failed'
      break
    }
    case 'checkout.session.expired': {
      sessionId = event.data.object.id
      next = 'expired'
      break
    }
    default:
      // Acknowledged, deliberately ignored.
      return NextResponse.json({ received: true })
  }

  if (!sessionId || !next) {
    return NextResponse.json({ received: true })
  }

  try {
    // Keyed on the Checkout session id, which the checkout route stored as the
    // order's payment_id. Stripe retries webhooks, so this must be idempotent:
    // writing the same status twice is a no-op, which it is.
    const order = await setPaymentStatus(sessionId, next)
    if (!order) {
      // 200, not 404: a missing order is not something Stripe can fix by
      // retrying, and a non-2xx would have it retry for days.
      return NextResponse.json({ received: true, matched: false })
    }
    return NextResponse.json({ received: true, order: order.id, paymentStatus: next })
  } catch (error) {
    // A genuine server-side failure — 500 so Stripe DOES retry.
    const message = error instanceof Error ? error.message : 'Failed to update order'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
