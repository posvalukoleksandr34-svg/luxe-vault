import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { findOrderByPaymentId } from '@/lib/server/orders-store'
import { constructWebhookEvent, getStripe, isStripeWebhookConfigured } from '@/lib/server/stripe'
import { onDispute, onEarlyFraudWarning } from '@/lib/server/payment-fraud'
import { applyPaymentIntent } from '@/lib/server/stripe-payment-apply'
import { claimStripeEvent, releaseStripeEvent } from '@/lib/server/stripe-events'
import { syncChargeRefunds, syncDispute, syncStripeRefund } from '@/lib/server/refunds/stripe-sync'
import { securityEvent } from '@/lib/server/security-events'
import type { PaymentStatus } from '@/lib/types'
import { reportCriticalError } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
// The signature is computed over the exact request bytes, so the body must not
// be parsed, re-encoded, or transformed by any middleware before it gets here.
export const runtime = 'nodejs'

/**
 * The events this handler acts on. Everything else is acknowledged and
 * ignored — Stripe sends dozens of types, and a 200 stops it retrying them.
 *
 * The endpoint must be subscribed to all of these in the Stripe dashboard.
 */
const HANDLED = [
  'payment_intent.succeeded',
  // Klarna and Amazon Pay authorise on the provider's own site and settle
  // afterwards, so this is the event that says "the customer has paid, the
  // money is on its way". It is what keeps an async order out of limbo
  // between the redirect back and the settlement.
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
  // The refund ledger (lib/server/refunds/stripe-sync.ts): a refund's own
  // lifecycle — pending → succeeded, or failed, even after succeeding.
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.refund.updated',
  // The fraud guard (lib/server/payment-fraud.ts). An early fraud warning on
  // an order not yet shipped is refunded automatically; a dispute is flagged.
  'radar.early_fraud_warning.created',
  'charge.dispute.created',
]

/**
 * Public by necessity — Stripe calls this directly, with no session of ours to
 * authenticate. The signature check is the entire trust boundary.
 *
 * Only Stripe's word marks a Stripe order paid: this signed event, or — when
 * an event never arrived — the owner's "apply Stripe status" in the payment
 * reconciliation, which fetches the PaymentIntent from Stripe itself and runs
 * the same code (lib/server/stripe-payment-apply.ts). The browser's
 * arrival at /success — and the `redirect_status` Stripe puts in that URL — is
 * a navigation hint and nothing more: anyone can type that URL, so treating it
 * as proof of payment would let a customer mark their own order paid by
 * editing the address bar. confirmPayment() resolving successfully in the
 * client is likewise not authoritative.
 *
 * EXACTLY ONCE. Stripe delivers at least once, so every handled event is
 * claimed by its id (stripe_events, migration 0027) before any work: a
 * redelivery is acknowledged and not processed again. A failure releases the
 * claim, so Stripe's retry does the work instead of finding it "done".
 */
export async function POST(request: NextRequest) {
  if (!isStripeWebhookConfigured()) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // .text(), never .json() — see the runtime note above.
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event: Stripe.Event
  try {
    event = constructWebhookEvent(rawBody, signature)
  } catch (error) {
    // The SDK's reason (no matching signature, timestamp outside tolerance)
    // stays in the log; the caller — Stripe or whoever forged the request —
    // learns only that it was refused.
    console.warn('[stripe] webhook refused:', error instanceof Error ? error.message : error)
    securityEvent('webhook_signature_invalid', { route: 'stripe', reason: signature ? 'mismatch or stale' : 'missing header' })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (HANDLED.indexOf(event.type) === -1) {
    // Acknowledged, deliberately ignored.
    return NextResponse.json({ received: true })
  }

  const claim = await claimStripeEvent(event.id, event.type)
  if (claim === 'duplicate') {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    if (event.type === 'charge.refunded') {
      const synced = await syncChargeRefunds(event.data.object as Stripe.Charge, event.id)
      return NextResponse.json({ received: true, refunds: synced.length, matched: synced.filter((s) => s.matched).length })
    }
    if (
      event.type === 'refund.created' ||
      event.type === 'refund.updated' ||
      event.type === 'refund.failed' ||
      event.type === 'charge.refund.updated'
    ) {
      const synced = await syncStripeRefund(event.data.object as Stripe.Refund, event.id)
      return NextResponse.json({ received: true, ...synced })
    }
    if (event.type === 'charge.dispute.created') {
      // The order's open refund cases stop: no refund through Stripe while a
      // chargeback is open (the card network handles the money).
      await syncDispute(event.data.object as Stripe.Dispute)
    }
    if (event.type === 'radar.early_fraud_warning.created' || event.type === 'charge.dispute.created') {
      return await handleFraudSignal(event)
    }
    return await handlePaymentIntent(event)
  } catch (error) {
    // A genuine server-side failure — give the claim back and answer 500 so
    // Stripe DOES retry, and the retry can claim and process it.
    if (claim === 'claimed') await releaseStripeEvent(event.id)
    const message = error instanceof Error ? error.message : 'Failed to update order'
    // The full error, stack included, in the platform logs. reportCriticalError
    // below reaches Telegram only when the bot is configured; this line is
    // what makes a 500 diagnosable either way.
    console.error(`[stripe] webhook ${event.type} ${event.id} failed:`, error)
    await reportCriticalError(`Stripe webhook ${event.type}`, message)
    // Generic on the wire: a database error text is for the log above, not
    // for a response body Stripe stores and shows in its dashboard.
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

/**
 * payment_intent.* — the order's money state.
 *
 * These are payment_intent events, NOT checkout.session.*: with an embedded
 * PaymentElement there is no Checkout Session, so the old handlers would never
 * fire and every order would sit at `pending_payment` while the customer was
 * charged.
 */
async function handlePaymentIntent(event: Stripe.Event): Promise<NextResponse> {
  const intent = event.data.object as Stripe.PaymentIntent
  const next: PaymentStatus | null =
    event.type === 'payment_intent.succeeded'
      ? 'paid'
      : event.type === 'payment_intent.processing'
        ? // Delayed methods (some bank debits) settle asynchronously.
          'confirming'
        : event.type === 'payment_intent.payment_failed'
          ? 'failed'
          : event.type === 'payment_intent.canceled'
            ? 'expired'
            : null

  if (!intent?.id || !next) return NextResponse.json({ received: true })
  // Everything the event means for the order — the checks, the status, the
  // stock, the slips and emails — is lib/server/stripe-payment-apply.ts.
  return NextResponse.json(await applyPaymentIntent(intent, next, event.type))
}

/**
 * radar.early_fraud_warning.created and charge.dispute.created. Both name a
 * charge; the order is found through its PaymentIntent.
 */
async function handleFraudSignal(event: Stripe.Event): Promise<NextResponse> {
  const object = event.data.object as Stripe.Radar.EarlyFraudWarning | Stripe.Dispute
  let paymentIntentId = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id
  if (!paymentIntentId) {
    const chargeId = typeof object.charge === 'string' ? object.charge : object.charge?.id
    if (chargeId) {
      const charge = await getStripe().charges.retrieve(chargeId)
      paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
    }
  }
  const order = paymentIntentId ? await findOrderByPaymentId(paymentIntentId) : null
  if (!order) {
    await reportCriticalError(`Stripe ${event.type} matched no order`, `${object.id} · ${paymentIntentId ?? 'no payment intent'}`)
    return NextResponse.json({ received: true, matched: false })
  }
  if (event.type === 'charge.dispute.created') {
    await onDispute(order, object as Stripe.Dispute)
    return NextResponse.json({ received: true, order: order.id, flagged: 'dispute' })
  }
  const outcome = await onEarlyFraudWarning(order, object as Stripe.Radar.EarlyFraudWarning)
  return NextResponse.json({ received: true, order: order.id, earlyFraudWarning: outcome })
}
