import { NextResponse, type NextRequest } from 'next/server'
import {
  claimReceiptSend,
  releaseReceiptClaim,
  setPaymentStatus,
} from '@/lib/server/orders-store'
import { isMailConfigured, sendPaymentReceipt } from '@/lib/server/mailer'
import { notifyPaymentFailed } from '@/lib/server/notifications'
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
 * This is the ONLY place a Stripe order is ever marked paid. The browser's
 * arrival at /success — and the `redirect_status` Stripe puts in that URL — is
 * a navigation hint and nothing more: anyone can type that URL, so treating it
 * as proof of payment would let a customer mark their own order paid by
 * editing the address bar. confirmPayment() resolving successfully in the
 * client is likewise not authoritative; only this signed event is.
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
  //
  // These are payment_intent.* events, NOT checkout.session.*. The move to an
  // embedded PaymentElement means there is no Checkout Session any more, so
  // the old handlers would simply never fire and every order would sit at
  // `pending_payment` for ever while the customer was charged.
  let next: PaymentStatus | null = null
  let paymentIntentId: string | null = null

  switch (event.type) {
    case 'payment_intent.succeeded': {
      paymentIntentId = event.data.object.id
      next = 'paid'
      break
    }
    case 'payment_intent.processing': {
      // Delayed methods (some bank debits) settle asynchronously.
      paymentIntentId = event.data.object.id
      next = 'confirming'
      break
    }
    case 'payment_intent.payment_failed': {
      paymentIntentId = event.data.object.id
      next = 'failed'
      break
    }
    case 'payment_intent.canceled': {
      paymentIntentId = event.data.object.id
      next = 'expired'
      break
    }
    default:
      // Acknowledged, deliberately ignored.
      return NextResponse.json({ received: true })
  }

  if (!paymentIntentId || !next) {
    return NextResponse.json({ received: true })
  }

  try {
    // Keyed on the PaymentIntent id, which the intent route stored as the
    // order's payment_id. Stripe retries webhooks, so this must be idempotent:
    // writing the same status twice is a no-op, which it is.
    const order = await setPaymentStatus(paymentIntentId, next)
    if (!order) {
      // 200, not 404: a missing order is not something Stripe can fix by
      // retrying, and a non-2xx would have it retry for days.
      return NextResponse.json({ received: true, matched: false })
    }

    // In-app notification for a failed payment. Guest orders have no user_id
    // and therefore nowhere to deliver a notification — they still get the
    // order page via their lookup token.
    //
    // Deliberately not awaited for its result beyond a boolean: a failed
    // insert must never turn this handler non-2xx, because Stripe would then
    // retry the whole event and re-run the money-state update above.
    if (next === 'failed' && order.userId) {
      await notifyPaymentFailed({
        userId: order.userId,
        orderId: order.id,
        reason: event.type === 'payment_intent.payment_failed'
          ? event.data.object.last_payment_error?.message
          : undefined,
      })
    }

    // Transactional receipt, sent only on a real settlement.
    //
    // The send is guarded by an atomic claim rather than by checking a flag:
    // Stripe delivers at least once, and two retries can be in flight in two
    // separate serverless invocations that share no memory, so check-then-send
    // would race and email the customer twice.
    let receiptSent = false
    if (next === 'paid' && isMailConfigured) {
      const claimed = await claimReceiptSend(paymentIntentId)
      if (claimed) {
        receiptSent = await sendPaymentReceipt(claimed)
        if (!receiptSent) {
          // Hand the claim back so a later retry can try again — otherwise a
          // transient Resend outage would suppress the receipt permanently.
          await releaseReceiptClaim(paymentIntentId)
          console.warn(`[receipts] ${claimed.id} payment succeeded but receipt was not sent`)
        }
      }
    }

    // Always 200 once the payment status is written. An email failure must not
    // make Stripe retry the event and re-run the money-state update.
    return NextResponse.json({
      received: true,
      order: order.id,
      paymentStatus: next,
      receiptSent,
    })
  } catch (error) {
    // A genuine server-side failure — 500 so Stripe DOES retry.
    const message = error instanceof Error ? error.message : 'Failed to update order'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
