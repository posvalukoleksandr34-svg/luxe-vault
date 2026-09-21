import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { fromMinorUnits, orderChargeRate, roundMinor } from '@/lib/currency'
import {
  adoptPaymentIntent,
  claimReceiptSend,
  ensurePaidOrderStock,
  findOrderByPaymentId,
  recordRefund,
  releaseReceiptClaim,
  setPaymentStatus,
} from '@/lib/server/orders-store'
import {
  isMailConfigured,
  sendPaymentFailedEmail,
  sendPaymentReceipt,
  sendStockConflictAlert,
} from '@/lib/server/mailer'
import { notifyPaymentFailed } from '@/lib/server/notifications'
import { constructWebhookEvent, isStripeWebhookConfigured } from '@/lib/server/stripe'
import { claimStripeEvent, releaseStripeEvent } from '@/lib/server/stripe-events'
import type { PaymentStatus } from '@/lib/types'
import { isTelegramConfigured, notifyPaymentConfirmed, notifyStockConflict, reportCriticalError } from '@/lib/telegram'

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
]

/**
 * Money states an order cannot be talked out of by a later event. Compared
 * against the order's CURRENT status, not the event's.
 */
const SETTLED: PaymentStatus[] = ['paid', 'refunded', 'partially_refunded']

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
    const message = error instanceof Error ? error.message : 'Invalid signature'
    return NextResponse.json({ error: message }, { status: 400 })
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
      const synced = await syncRefund(event.data.object as Stripe.Charge)
      return NextResponse.json({ received: true, ...synced })
    }
    return await handlePaymentIntent(event)
  } catch (error) {
    // A genuine server-side failure — give the claim back and answer 500 so
    // Stripe DOES retry, and the retry can claim and process it.
    if (claim === 'claimed') await releaseStripeEvent(event.id)
    const message = error instanceof Error ? error.message : 'Failed to update order'
    await reportCriticalError(`Stripe webhook ${event.type}`, message)
    return NextResponse.json({ error: message }, { status: 500 })
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

  // A failure that arrives AFTER the money did.
  //
  // One PaymentIntent can carry several attempts: a card declined by 3-D
  // Secure, then Klarna, then a card that works. Each failed attempt emits
  // `payment_intent.payment_failed`, and Stripe does not promise to deliver
  // those before the `succeeded` that follows — a retried delivery can be
  // hours late. Writing `failed` then would un-pay a paid order, email the
  // customer that their payment did not go through, and leave the piece
  // unfulfilled with their money taken.
  //
  // Read-then-skip rather than a guard inside setPaymentStatus: for the crypto
  // webhook a late `failed` is a REAL reversal (see that function), so the
  // asymmetry belongs here, on the provider that has attempts.
  if (next === 'failed' || next === 'expired') {
    const current = await findOrderByPaymentId(intent.id)
    if (current && SETTLED.indexOf(current.paymentStatus ?? 'pending_payment') !== -1) {
      console.warn(`[stripe] ignored late '${next}' for ${current.id}: already ${current.paymentStatus}`)
      return NextResponse.json({ received: true, order: current.id, ignored: 'already settled' })
    }
  }

  // Keyed on the PaymentIntent id, which the intent route stored as the
  // order's payment_id. Writing the same status twice is a no-op.
  let order = await setPaymentStatus(intent.id, next)

  if (!order) {
    // TWO KEYS, because one of them can be missing.
    //
    // payment_id is written by the intent route before the browser is given
    // the client secret, so it is there for every payment that went through
    // the checkout. When it is NOT — the write failed, the row was restored
    // from a backup, the intent was made outside that route — the money is
    // still not orphaned: preparePaymentIntent() puts the order id in the
    // PaymentIntent's metadata, and Stripe echoes it on every event.
    //
    // Without this the handler answered 200 with `matched: false` and the
    // order sat at pending_payment forever, while the customer had been
    // charged. Silent, and invisible in the Stripe dashboard, which only sees
    // a 200. Anything found this way also has its payment_id written back
    // (adoptPaymentIntent), so the next event for the same payment matches on
    // the fast path.
    const metadataOrderId = typeof intent.metadata?.orderId === 'string' ? intent.metadata.orderId.trim() : ''
    if (metadataOrderId) {
      order = await adoptPaymentIntent(metadataOrderId, intent.id, next)
      if (order) {
        console.warn(
          `[stripe] ${intent.id} had no payment_id on any order; matched ${order.id} by metadata and repaired it`,
        )
      }
    }
  }

  if (!order) {
    // 200, not 404: a missing order is not something Stripe can fix by
    // retrying, and a non-2xx would have it retry for days. Reported, though —
    // a payment whose order cannot be found by EITHER key is a real incident,
    // and the whole point of the fallback above is that this should not
    // happen for a payment the shop itself created.
    await reportCriticalError(
      'Stripe payment matched no order',
      `${event.type} for ${intent.id} (metadata.orderId=${intent.metadata?.orderId ?? 'unset'})`,
    )
    return NextResponse.json({ received: true, matched: false })
  }

  // Stock at payment confirmation: the order must still hold its units. If it
  // was cancelled and restocked while the customer was paying, they are taken
  // again atomically — or, when they are gone, support is told to refund.
  if (next === 'paid') {
    const stock = await ensurePaidOrderStock(order.id)
    if (stock === 'insufficient') {
      console.error(`[stripe] ${order.id} was paid but its stock had been released and sold`)
      if (isMailConfigured) await sendStockConflictAlert(order)
      await notifyStockConflict(order)
    }
    // Once per order, via the event ledger — the same guard as the emails.
    if (
      isTelegramConfigured() &&
      (await claimStripeEvent(`telegram:paid:${order.id}`, 'telegram.paid')) !== 'duplicate'
    ) {
      await notifyPaymentConfirmed(order, 'stripe', {
        amount: fromMinorUnits(intent.amount_received || intent.amount),
        currency: intent.currency.toUpperCase(),
      })
    }
  }

  // In-app notification for a failed payment. Guest orders have no user_id
  // and nowhere to deliver one — they still reach the order via its token.
  if (next === 'failed' && order.userId) {
    await notifyPaymentFailed({
      userId: order.userId,
      orderId: order.id,
      reason: intent.last_payment_error?.message,
    })
  }

  // "Payment not completed" email — once per ORDER, not once per declined
  // attempt: a customer trying three cards should get one email, not three.
  // The claim reuses the event ledger under a synthetic id; without the
  // ledger (pre-0027) it is skipped rather than risk repeats.
  if (next === 'failed' && isMailConfigured) {
    const once = await claimStripeEvent(`email:payment_failed:${order.id}`, 'email.payment_failed')
    if (once === 'claimed') await sendPaymentFailedEmail(order)
  }

  // Transactional receipt, sent only on a real settlement — guarded by an
  // atomic claim on the order, because two deliveries of the SAME event can
  // arrive before either finishes (the event claim above covers redelivery;
  // this covers the receipt specifically, and pre-0027 deployments).
  let receiptSent = false
  if (next === 'paid' && isMailConfigured) {
    const claimed = await claimReceiptSend(intent.id)
    if (claimed) {
      receiptSent = await sendPaymentReceipt(claimed)
      if (!receiptSent) {
        // Hand the claim back so a later retry can try again — otherwise a
        // transient mail outage would suppress the receipt permanently.
        await releaseReceiptClaim(intent.id)
        console.warn(`[receipts] ${claimed.id} payment succeeded but receipt was not sent`)
      }
    }
  }

  // Always 200 once the payment status is written. An email failure must not
  // make Stripe retry the event and re-run the money-state update.
  return NextResponse.json({ received: true, order: order.id, paymentStatus: next, receiptSent })
}

/**
 * charge.refunded — keeps the order in step with refunds made OUTSIDE the
 * admin console (the Stripe dashboard, a dispute resolution).
 *
 * Stripe's figure is cumulative and in the currency charged; the order keeps
 * CHF, so it is converted at the rate the payment was made at (see
 * orderChargeRate). A refund the admin route already recorded arrives here
 * too, with the same total — that is detected and left alone, so nothing is
 * recorded, restocked or emailed twice.
 */
async function syncRefund(
  charge: Stripe.Charge,
): Promise<{ matched: boolean; changed?: boolean }> {
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntentId) return { matched: false }

  const order = await findOrderByPaymentId(paymentIntentId)
  if (!order) return { matched: false }

  const fully = Boolean(charge.refunded)
  const refundedChf = fully
    ? order.total
    : Math.min(order.total, roundMinor(fromMinorUnits(charge.amount_refunded) / orderChargeRate(order)))

  const already = order.refundedAmount ?? 0
  const alreadyFull = order.paymentStatus === 'refunded'
  if ((fully && alreadyFull) || (!fully && refundedChf <= already + 0.004)) {
    return { matched: true, changed: false }
  }

  const refundId = charge.refunds?.data?.[0]?.id ?? charge.id
  await recordRefund(order.id, { refundedAmount: refundedChf, fully, refundId })
  return { matched: true, changed: true }
}
