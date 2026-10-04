import { NextResponse, type NextRequest } from 'next/server'
import { isMailConfigured, sendStockConflictAlert } from '@/lib/server/mailer'
import { ensurePaidOrderStock, findOrderByPaymentId, setPaymentStatus } from '@/lib/server/orders-store'
import {
  cryptoFullyPaid,
  cryptoPaymentMismatch,
  getPayment,
  isConfigured,
  isIpnConfigured,
  toPaymentStatus,
  verifyIpnSignature,
} from '@/lib/server/nowpayments'
import { claimStripeEvent } from '@/lib/server/stripe-events'
import { isTelegramConfigured, notifyPaymentConfirmed, notifyStockConflict, reportCriticalError } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * NOWPayments' IPN — the only place a crypto order is ever marked paid (the
 * client's status polling only reads what this wrote).
 *
 * WHAT A VALID SIGNATURE PROVES, AND WHAT IT DOES NOT
 *
 * The HMAC proves NOWPayments sent this body at some point. It does not say
 * the body is current (an IPN carries no timestamp or nonce, so an old one can
 * be replayed — "expired" after the payment later finished), nor that the
 * payment is for the amount and the order we expect. So the IPN is treated as
 * a NOTIFICATION, not as the facts:
 *
 *   1. signature verified (unchanged, constant-time HMAC-SHA512);
 *   2. the payment re-read from NOWPayments' API — its status now, its order
 *      id, price, coin and what actually arrived;
 *   3. resolved to the order whose CURRENT payment_id it is, and checked
 *      against that order: same order id, priced in CHF at the stored order
 *      total, in the coin the order was created for (cryptoPaymentMismatch);
 *   4. "paid" only if what arrived covers the quoted amount;
 *   5. written through the payment state machine (setPaymentStatus), atomic
 *      in the database: a replayed, duplicated or out-of-order delivery can
 *      repeat a status but never un-pay an order.
 *
 * Any doubt is answered without touching the order: 503 when the provider
 * cannot be asked (NOWPayments retries), 200 + an operator alert when the
 * payment does not match (retrying would not change the facts).
 */
export async function POST(request: NextRequest) {
  if (!isIpnConfigured() || !isConfigured()) {
    // The API key is needed for step 2; without it nothing can be verified.
    return NextResponse.json({ error: 'Crypto payments not configured' }, { status: 503 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const signature = request.headers.get('x-nowpayments-sig')
  if (!(await verifyIpnSignature(payload, signature))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const rawId = (payload as { payment_id?: unknown } | null)?.payment_id
  const paymentId = typeof rawId === 'number' || typeof rawId === 'string' ? String(rawId) : ''
  if (!/^\d{1,20}$/.test(paymentId)) {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  // 2. The provider's record, now.
  const fetched = await getPayment(paymentId)
  if (!fetched.ok) {
    console.error(`[crypto] could not re-read payment ${paymentId} from NOWPayments: ${fetched.error.message}`)
    return NextResponse.json({ error: 'Payment could not be verified, retry' }, { status: 503 })
  }
  const payment = fetched.data

  // 3. The order this payment is CURRENTLY attached to.
  const order = await findOrderByPaymentId(paymentId)
  if (!order) {
    // Money for a payment no order points at — superseded by a newer payment
    // session, or never ours. Never applied automatically; a person looks.
    if (['confirmed', 'finished', 'partially_paid'].includes(payment.payment_status)) {
      await reportCriticalError(
        'Crypto payment matches no current order — not applied',
        `payment ${paymentId} · status ${payment.payment_status} · order_id ${payment.order_id ?? '—'}`,
      )
    }
    return NextResponse.json({ received: true, matched: false })
  }

  const problem = cryptoPaymentMismatch(order, payment)
  if (problem) {
    console.error(`[crypto] ${paymentId} NOT applied to ${order.id}: ${problem}`)
    await reportCriticalError('Crypto payment does not match its order — not applied', `${order.id} · ${paymentId} · ${problem}`)
    return NextResponse.json({ received: true, order: order.id, ignored: 'mismatch' })
  }

  // 4. Paid only when the coins that arrived cover the quote.
  let next = toPaymentStatus(payment.payment_status)
  if (next === 'paid' && !cryptoFullyPaid(payment)) {
    console.error(`[crypto] ${order.id} reported ${payment.payment_status} but underpaid (${payment.actually_paid} of ${payment.pay_amount})`)
    await reportCriticalError('Crypto payment underpaid — order kept unpaid', `${order.id} · ${paymentId} · ${payment.actually_paid} of ${payment.pay_amount} ${payment.pay_currency}`)
    next = 'confirming'
  }

  // 5. Through the state machine; null = refused (late/replayed) or no-op.
  const updated = await setPaymentStatus(paymentId, next)

  // Stock at payment confirmation — see the Stripe webhook: a restocked order
  // takes its units again, or support is told the payment needs a refund.
  // Both steps are idempotent, so a duplicate "finished" delivery repeats
  // nothing that matters.
  if (updated && next === 'paid') {
    const stock = await ensurePaidOrderStock(updated.id)
    if (stock === 'insufficient') {
      console.error(`[crypto] ${updated.id} was paid but its stock had been released and sold`)
      if (isMailConfigured) await sendStockConflictAlert(updated)
      await notifyStockConflict(updated)
    }
    // NOWPayments repeats "finished" IPNs; the ledger keeps this to one alert.
    if (
      isTelegramConfigured() &&
      (await claimStripeEvent(`telegram:paid:${updated.id}`, 'telegram.paid')) !== 'duplicate'
    ) {
      const amount = Number(payment.actually_paid ?? payment.pay_amount)
      await notifyPaymentConfirmed(
        updated,
        'nowpayments',
        amount > 0 && typeof payment.pay_currency === 'string'
          ? { amount, currency: payment.pay_currency.toUpperCase() }
          : undefined,
      )
    }
  }

  return NextResponse.json({ received: true, order: order.id, status: updated ? next : order.paymentStatus })
}
