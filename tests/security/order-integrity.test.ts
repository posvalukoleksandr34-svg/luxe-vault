import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CARD_PAYMENT_METHOD } from '@/lib/data'
import { cancellationFilter, cancellationRefusal, hasReceivedMoney } from '@/lib/payment-state'
import { MAX_ORDER_LINES, validateOrderDraft } from '@/lib/server/order-drafts'
import { refundIdempotencyKey, stripeLedgerAhead } from '@/lib/server/stripe'
import type { OrderStatus, PaymentStatus } from '@/lib/types'

const ALL_PAYMENT: (PaymentStatus | null)[] = [
  null,
  'pending_payment',
  'confirming',
  'paid',
  'failed',
  'expired',
  'refunded',
  'partially_refunded',
]
const ALL_STATUS: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']

describe('order cancellation (customer button, admin "cancelled" on an unpaid order)', () => {
  it('never cancels an order whose money arrived — paid, partially refunded or refunded', () => {
    for (const status of ALL_STATUS) {
      for (const paymentStatus of ['paid', 'partially_refunded', 'refunded'] as PaymentStatus[]) {
        assert.notEqual(cancellationRefusal({ status, paymentStatus }), null, `${status}/${paymentStatus}`)
      }
    }
    // The case that was reachable from the account page: partly refunded,
    // already delivered, shown as "unpaid" with a Cancel button.
    assert.equal(cancellationRefusal({ status: 'delivered', paymentStatus: 'partially_refunded' }), 'money_received')
    assert.equal(cancellationRefusal({ status: 'pending', paymentStatus: 'partially_refunded' }), 'money_received')
  })

  it('waits for a payment that is settling', () => {
    assert.equal(cancellationRefusal({ status: 'pending', paymentStatus: 'confirming' }), 'payment_in_flight')
  })

  it('does not put shipped units back on sale', () => {
    for (const status of ['shipped', 'delivered'] as OrderStatus[]) {
      assert.equal(cancellationRefusal({ status, paymentStatus: 'pending_payment' }), 'already_fulfilled')
    }
  })

  it('cancels an unpaid order that has not shipped', () => {
    for (const status of ['pending', 'processing'] as OrderStatus[]) {
      for (const paymentStatus of [null, 'pending_payment', 'failed', 'expired'] as (PaymentStatus | null)[]) {
        assert.equal(cancellationRefusal({ status, paymentStatus }), null, `${status}/${paymentStatus}`)
      }
    }
    assert.equal(cancellationRefusal({ status: 'cancelled', paymentStatus: 'expired' }), 'already_cancelled')
  })

  it('the database filter admits exactly the payment states the rule admits', () => {
    const filter = cancellationFilter()
    assert.equal(filter, 'payment_status.is.null,payment_status.in.(pending_payment,failed,expired)')
    for (const paymentStatus of ALL_PAYMENT) {
      const inFilter: boolean = paymentStatus === null ? filter.includes('is.null') : new RegExp(`[(,]${paymentStatus}[,)]`).test(filter)
      const allowed = cancellationRefusal({ status: 'pending', paymentStatus }) === null
      assert.equal(inFilter, allowed, String(paymentStatus))
    }
  })

  it('money that arrived stays "received" after a refund', () => {
    assert.deepEqual(
      ALL_PAYMENT.filter(hasReceivedMoney),
      ['paid', 'refunded', 'partially_refunded'],
    )
  })
})

describe('order size', () => {
  const customer = {
    firstName: 'Anna',
    lastName: 'Muster',
    phone: '+41791234567',
    email: 'anna@example.com',
    street: 'Bahnhofstrasse 1',
    postalCode: '8001',
    city: 'Zürich',
    country: 'CH',
  }
  const line = (n: number) => ({ key: `k${n}`, productId: `p${n}`, name: 'x', image: '', price: 1, qty: 1, size: 'M', color: 'Black' })

  it('accepts as many lines as the cart can hold', () => {
    const result = validateOrderDraft({
      customer,
      payment: CARD_PAYMENT_METHOD,
      items: Array.from({ length: MAX_ORDER_LINES }, (_, n) => line(n)),
    })
    assert.equal(result.ok, true, result.ok ? '' : result.error)
  })

  it('refuses more lines than the cart can hold', () => {
    const result = validateOrderDraft({
      customer,
      payment: CARD_PAYMENT_METHOD,
      items: Array.from({ length: MAX_ORDER_LINES + 1 }, (_, n) => line(n)),
    })
    assert.deepEqual(result, { ok: false, error: 'Too many items' })
  })
})

describe('refund idempotency', () => {
  it('a repeated refund request reaches Stripe with the same key', () => {
    assert.equal(refundIdempotencyKey('pi_1', 0, 0, 3000), refundIdempotencyKey('pi_1', 0, 0, 3000))
  })

  it('a deliberate second refund — after the first is on either ledger — gets a new key', () => {
    const first = refundIdempotencyKey('pi_1', 0, 0, 3000)
    // Stripe's ledger moved…
    assert.notEqual(first, refundIdempotencyKey('pi_1', 3000, 0, 3000))
    // …or only ours did (Stripe's figure lagging must not merge two refunds).
    assert.notEqual(first, refundIdempotencyKey('pi_1', 0, 3000, 3000))
    assert.notEqual(first, refundIdempotencyKey('pi_1', 0, 0, 2000))
    assert.notEqual(first, refundIdempotencyKey('pi_2', 0, 0, 3000))
  })

  it('two presses racing: the second sees Stripe already refunded what the order does not yet record → refused', () => {
    // First refund of CHF 100 created at Stripe, not yet recorded on the order.
    assert.equal(stripeLedgerAhead(10000, 0, 1, 20000), true)
    // A partial refund in flight on top of an earlier, recorded one.
    assert.equal(stripeLedgerAhead(15000, 100, 1, 20000), true)
  })

  it('ledgers that agree: a deliberate further refund may go ahead', () => {
    assert.equal(stripeLedgerAhead(0, 0, 1, 20000), false)
    assert.equal(stripeLedgerAhead(10000, 100, 1, 20000), false)
    // The order ahead of Stripe (Stripe's figure lagging) is not this check's concern: the key differs.
    assert.equal(stripeLedgerAhead(0, 100, 1, 20000), false)
  })

  it('a converted payment tolerates a cent of rounding, not a refund', () => {
    // EUR at 1.07: CHF 93.46 recorded ≈ EUR 100.00 at Stripe.
    assert.equal(stripeLedgerAhead(10000, 93.46, 1.07, 21400), false)
    assert.equal(stripeLedgerAhead(10002, 93.46, 1.07, 21400), false)
    // A further EUR 10 refund at Stripe that the order does not show yet.
    assert.equal(stripeLedgerAhead(11000, 93.46, 1.07, 21400), true)
  })
})
