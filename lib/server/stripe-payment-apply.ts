import 'server-only'

import type Stripe from 'stripe'
import { fromMinorUnits, orderCharge, toMinorUnits } from '@/lib/currency'
import {
  adoptPaymentIntent,
  claimReceiptSend,
  ensurePaidOrderStock,
  findOrderByPaymentId,
  getOrderById,
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
import { onCardFailure, onCardSuccess } from '@/lib/server/payment-fraud'
import { claimStripeEvent } from '@/lib/server/stripe-events'
import type { Order, PaymentStatus } from '@/lib/types'
import { isTelegramConfigured, notifyPaymentConfirmed, notifyStockConflict, reportCriticalError } from '@/lib/telegram'

/**
 * What a Stripe PaymentIntent means for its order — the one code path that
 * writes a card order's money state.
 *
 * Two callers, and only two:
 *   - the signed webhook (app/api/payments/stripe/webhook/route.ts), with the
 *     intent Stripe sent;
 *   - the owner's "apply Stripe status" in the payment reconciliation
 *     (app/api/admin/reconciliation/apply/route.ts), with the intent the
 *     server has just fetched from Stripe itself.
 *
 * Neither takes the browser's word for anything: the intent comes from Stripe
 * either way. Every check — a late failure after the money, a payment for a
 * different amount or currency, the order found by payment id or by the
 * intent's metadata — is the same for both, because it is this function.
 *
 * Repeating it is safe: the same status twice is a no-op in setPaymentStatus,
 * and the stock check, the Telegram slip and the receipt each have their own
 * once-only claim.
 */

export type PaymentIntentOutcome =
  | { received: true }
  | { received: true; order: string; ignored: 'already settled' | 'amount mismatch' }
  | { received: true; matched: false }
  | { received: true; order: string; paymentStatus: PaymentStatus; receiptSent: boolean }

/**
 * Money states an order cannot be talked out of by a later event. Compared
 * against the order's CURRENT status, not the event's.
 */
const SETTLED: PaymentStatus[] = ['paid', 'refunded', 'partially_refunded']

/**
 * One consequence of a payment whose status is already saved. Isolated: an
 * exception is logged with its stack and reported, and never reaches the
 * handler's catch — which would answer 500 and have Stripe retry an update
 * that already succeeded.
 */
async function afterPayment(what: string, orderId: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    console.error(`[stripe] ${what} for ${orderId} failed (the payment status is saved):`, error)
    await reportCriticalError(`Stripe webhook · ${what}`, error).catch(() => false)
  }
}

export async function applyPaymentIntent(
  intent: Stripe.PaymentIntent,
  next: PaymentStatus,
  /** For the reports: which event or action asked. */
  source: string,
): Promise<PaymentIntentOutcome> {
  if (!intent?.id) return { received: true }

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
  // setPaymentStatus refuses this transition in the database too (the payment
  // state machine); answering here first keeps the response and the log
  // explicit about why nothing changed.
  if (next === 'failed' || next === 'expired') {
    const current = await findOrderByPaymentId(intent.id)
    if (current && SETTLED.indexOf(current.paymentStatus ?? 'pending_payment') !== -1) {
      console.warn(`[stripe] ignored late '${next}' for ${current.id}: already ${current.paymentStatus}`)
      return { received: true, order: current.id, ignored: 'already settled' }
    }
  }

  // Keyed on the PaymentIntent id, which the intent route stored as the
  // order's payment_id. Writing the same status twice is a no-op.
  // A payment marks an order paid only if it paid THAT order's amount, in its
  // currency. The PaymentIntent is created server-side from the order total,
  // so for our own intents this always holds; what it stops is a payment
  // created elsewhere on the same Stripe account (another integration, a
  // Dashboard charge) carrying an orderId in its metadata — the adoption path
  // below would otherwise mark an expensive order paid with a cheap payment.
  if (next === 'paid') {
    const metadataOrderId = typeof intent.metadata?.orderId === 'string' ? intent.metadata.orderId.trim() : ''
    const target =
      (await findOrderByPaymentId(intent.id)) ?? (metadataOrderId ? await getOrderById(metadataOrderId) : null)
    const problem = target ? chargeMismatch(target, intent) : null
    if (target && problem) {
      console.error(`[stripe] ${intent.id} NOT applied to ${target.id}: ${problem}`)
      await reportCriticalError('Stripe payment does not match its order — not marked paid', `${target.id} · ${intent.id} · ${problem}`)
      return { received: true, order: target.id, ignored: 'amount mismatch' }
    }
  }

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
      `${source} for ${intent.id} (metadata.orderId=${intent.metadata?.orderId ?? 'unset'})`,
    )
    return { received: true, matched: false }
  }

  // FROM HERE ON THE PAYMENT STATUS IS SAVED. Everything below is a
  // consequence of it — a stock check, a Telegram slip, emails — and each runs
  // in its own try/catch (afterPayment). A failure in one is logged with its
  // stack and reported, and never turns the answer into a 500: that would
  // make Stripe retry an event whose money-state update already succeeded.
  const paidOrder = order

  // Stock at payment confirmation: the order must still hold its units. If it
  // was cancelled and restocked while the customer was paying, they are taken
  // again atomically — or, when they are gone, support is told to refund.
  if (next === 'paid') {
    await afterPayment('stock check', paidOrder.id, async () => {
      const stock = await ensurePaidOrderStock(paidOrder.id)
      if (stock === 'insufficient') {
        console.error(`[stripe] ${paidOrder.id} was paid but its stock had been released and sold`)
        if (isMailConfigured) await sendStockConflictAlert(paidOrder)
        await notifyStockConflict(paidOrder)
      }
    })
    // Once per order, via the event ledger — the same guard as the emails.
    await afterPayment('Telegram slip', paidOrder.id, async () => {
      if (!isTelegramConfigured()) return
      if ((await claimStripeEvent(`telegram:paid:${paidOrder.id}`, 'telegram.paid')) === 'duplicate') return
      const sent = await notifyPaymentConfirmed(paidOrder, 'stripe', {
        amount: fromMinorUnits(intent.amount_received || intent.amount),
        currency: (intent.currency ?? 'chf').toUpperCase(),
      })
      if (!sent) console.warn(`[stripe] ${paidOrder.id} paid, but the Telegram slip was not delivered (see [telegram] above)`)
    })
  }

  // The fraud guard: a paid order Radar scored as risky is flagged for the
  // admin; a failed card attempt is counted, and too many — or one that says
  // the card is stolen or fraudulent — cancel the intent and lock the order.
  if (next === 'paid') {
    await afterPayment('risk check', paidOrder.id, () => onCardSuccess(paidOrder, intent))
  }
  if (next === 'failed') {
    await afterPayment('fraud guard', paidOrder.id, () => onCardFailure(paidOrder, intent))
  }

  // In-app notification for a failed payment. Guest orders have no user_id
  // and nowhere to deliver one — they still reach the order via its token.
  if (next === 'failed' && paidOrder.userId) {
    const userId = paidOrder.userId
    await afterPayment('failed-payment notification', paidOrder.id, () =>
      notifyPaymentFailed({ userId, orderId: paidOrder.id, reason: intent.last_payment_error?.message }),
    )
  }

  // "Payment not completed" email — once per ORDER, not once per declined
  // attempt: a customer trying three cards should get one email, not three.
  // The claim reuses the event ledger under a synthetic id; without the
  // ledger (pre-0027) it is skipped rather than risk repeats.
  if (next === 'failed' && isMailConfigured) {
    await afterPayment('failed-payment email', paidOrder.id, async () => {
      const once = await claimStripeEvent(`email:payment_failed:${paidOrder.id}`, 'email.payment_failed')
      if (once === 'claimed') await sendPaymentFailedEmail(paidOrder)
    })
  }

  // Transactional receipt, sent only on a real settlement — guarded by an
  // atomic claim on the order, because two deliveries of the SAME event can
  // arrive before either finishes (the event claim above covers redelivery;
  // this covers the receipt specifically, and pre-0027 deployments).
  let receiptSent = false
  if (next === 'paid' && isMailConfigured) {
    await afterPayment('receipt email', paidOrder.id, async () => {
      const claimed = await claimReceiptSend(intent.id)
      if (!claimed) return
      receiptSent = await sendPaymentReceipt(claimed)
      if (!receiptSent) {
        // Hand the claim back so a later retry can try again — otherwise a
        // transient mail outage would suppress the receipt permanently.
        await releaseReceiptClaim(intent.id)
        console.warn(`[receipts] ${claimed.id} payment succeeded but receipt was not sent`)
      }
    })
  }

  // Always 200 once the payment status is written. An email failure must not
  // make Stripe retry the event and re-run the money-state update.
  return { received: true, order: order.id, paymentStatus: next, receiptSent }
}

/** Why this payment cannot settle this order, or null when it can. */
export function chargeMismatch(order: Order, intent: Stripe.PaymentIntent): string | null {
  const expected = orderCharge(order)
  const currency = (intent.currency ?? '').toUpperCase()
  if (currency !== expected.currency) return `currency ${currency || '?'} instead of ${expected.currency}`
  const received = intent.amount_received || 0
  const due = toMinorUnits(expected.amount)
  if (!(due > 0) || received < due) return `received ${received} minor units, order requires ${due}`
  return null
}
