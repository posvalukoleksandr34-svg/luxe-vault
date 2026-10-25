import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { reconcilePayments, type ProviderPayment } from '@/lib/payment-reconciliation'
import { paymentInFlightAlert, releaseExpiredReservations, reservationPolicy, type LapsedOrder, type ReservationDeps } from '@/lib/server/reservations'
import { isAmbiguousStripeFailure, isMissingIntent } from '@/lib/server/stripe'
import { hasBearerSecret } from '@/lib/server/secure-compare'
import type { Order } from '@/lib/types'

describe('reservation policy', () => {
  it('defaults: 48 h hold, 60 min grace, 72 h ceiling', () => {
    assert.deepEqual(reservationPolicy({}), { holdHours: 48, graceMinutes: 60, ceilingHours: 72 })
  })

  it('can be switched off explicitly', () => {
    assert.equal(reservationPolicy({ RESERVATION_EXPIRY: 'off' }), null)
    assert.equal(reservationPolicy({ RESERVATION_EXPIRY: 'OFF' }), null)
  })

  it('clamps nonsense to safe bounds instead of disabling or racing', () => {
    assert.equal(reservationPolicy({ RESERVATION_HOLD_HOURS: '0' })!.holdHours, 1)
    assert.equal(reservationPolicy({ RESERVATION_HOLD_HOURS: '-5' })!.holdHours, 1)
    assert.equal(reservationPolicy({ RESERVATION_HOLD_HOURS: '100000' })!.holdHours, 168)
    assert.equal(reservationPolicy({ RESERVATION_HOLD_HOURS: 'soon' })!.holdHours, 48)
    assert.equal(reservationPolicy({ RESERVATION_GRACE_MINUTES: '1' })!.graceMinutes, 5)
  })

  it('the ceiling is never shorter than the hold', () => {
    assert.equal(reservationPolicy({ RESERVATION_HOLD_HOURS: '120', RESERVATION_CEILING_HOURS: '10' })!.ceilingHours, 120)
    assert.equal(reservationPolicy({ RESERVATION_HOLD_HOURS: '100' })!.ceilingHours, 124)
  })
})

describe('reservation release: every order lands in exactly one list, and failures are retried', () => {
  const policy = { holdHours: 48, graceMinutes: 60, ceilingHours: 72 }
  const card = (no: string): LapsedOrder => ({ order_number: no, payment_provider: 'stripe', payment_id: `pi_${no}` })
  const crypto = (no: string): LapsedOrder => ({ order_number: no, payment_provider: 'nowpayments', payment_id: 'np_1' })

  /** An in-memory shop: orders, a shelf, and switches for each failure. */
  function shop(lapsed: LapsedOrder[], opts: { intents?: Record<string, 'open' | 'succeeded' | 'processing' | 'error' | 'missing'>; dbDown?: Set<string>; restockDown?: Set<string>; changed?: Set<string> } = {}) {
    const state = { cancelled: new Set<string>(), restocked: new Set<string>(), shelf: 0, stripeCalls: 0, cancelCalls: 0 }
    const deps: ReservationDeps = {
      async listLapsed() { return lapsed.filter((o) => !state.cancelled.has(o.order_number)) },
      stripeConfigured: () => true,
      async cancelPaymentIntent(id) {
        state.stripeCalls++
        const s = opts.intents?.[id] ?? 'open'
        if (s === 'error') return { ok: false, reason: 'error', message: 'timeout' }
        if (s === 'missing') return { ok: false, reason: 'missing', message: `No such payment_intent: '${id}'` }
        if (s === 'succeeded' || s === 'processing') return { ok: false, reason: 'captured', message: s, intentStatus: s }
        return { ok: true, alreadyTerminal: false }
      },
      async cancel(no) {
        state.cancelCalls++
        if (opts.dbDown?.has(no)) throw new Error('connection reset')
        if (opts.changed?.has(no) || state.cancelled.has(no)) return { conflict: true, restockFailed: false }
        state.cancelled.add(no)
        if (opts.restockDown?.has(no)) return { conflict: false, restockFailed: true }
        state.restocked.add(no); state.shelf++
        return { conflict: false, restockFailed: false }
      },
      async listUnrestocked() { return Array.from(state.cancelled).filter((no) => !state.restocked.has(no)) },
      async restock(no) {
        if (opts.restockDown?.has(no)) throw new Error('restore_order_stock failed')
        if (state.restocked.has(no)) return false
        state.restocked.add(no); state.shelf++
        return true
      },
    }
    return { state, deps }
  }
  const ok = <T,>(r: T) => r as Extract<Awaited<ReturnType<typeof releaseExpiredReservations>>, { status: 'ok' }>

  it('releases unpaid card and crypto orders; the card intent is cancelled first', async () => {
    const { state, deps } = shop([card('A'), crypto('B')])
    const r = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual(r.released, ['A', 'B'])
    assert.equal(state.stripeCalls, 1)
    assert.equal(state.shelf, 2)
  })

  it('a payment that succeeds or is processing during the cleanup is left for the webhook', async () => {
    const { state, deps } = shop([card('A'), card('B')], { intents: { pi_A: 'succeeded', pi_B: 'processing' } })
    const r = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual(r.paymentInFlight, ['A', 'B'])
    assert.deepEqual(r.paymentInFlightStatus, { A: 'succeeded', B: 'processing' }, 'Stripe\'s status is kept for the alert')
    assert.equal(state.cancelCalls, 0, 'never cancels an order whose payment went through')
    assert.equal(state.shelf, 0)
  })

  it('a payment Stripe took for an order still unpaid here is alerted, not just counted', () => {
    const text = paymentInFlightAlert(['A', 'B', 'C'], { A: 'succeeded', B: 'processing', C: 'succeeded' })
    assert.ok(text)
    assert.match(text!, /2 payment\(s\) as SUCCEEDED.*A, C/)
    assert.match(text!, /still processing.*B \(processing\)/)
    assert.match(text!, /Webhooks/, 'says where to look')
    assert.equal(paymentInFlightAlert([], {}), null, 'nothing to say, no alert')
    assert.doesNotMatch(paymentInFlightAlert(['B'], { B: 'processing' })!, /SUCCEEDED/)
  })

  it('Stripe unreachable, or not configured: nothing released, retried next run', async () => {
    const { state, deps } = shop([card('A')], { intents: { pi_A: 'error' } })
    assert.deepEqual(ok(await releaseExpiredReservations({ policy, deps })).providerError, ['A'])
    assert.equal(state.cancelCalls, 0)
    const off = shop([card('B')])
    assert.deepEqual(ok(await releaseExpiredReservations({ policy, deps: { ...off.deps, stripeConfigured: () => false } })).providerError, ['B'])
    assert.equal(off.state.stripeCalls, 0)
  })

  it('the alert carries Stripe\'s answer for each order it could not cancel', async () => {
    const { deps } = shop([card('A')], { intents: { pi_A: 'error' } })
    assert.deepEqual(ok(await releaseExpiredReservations({ policy, deps })).providerMessages, { A: 'timeout' })
  })

  it('a payment Stripe does not have (test-mode order on a live shop) is released once, not retried forever', async () => {
    const { state, deps } = shop([card('A'), card('B')], { intents: { pi_A: 'missing' } })
    const r = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual(r.releasedMissingIntent, ['A'])
    assert.deepEqual(r.released, ['B'])
    assert.deepEqual(r.providerError, [])
    assert.equal(state.shelf, 2, 'its units are back on sale')
    const again = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual(again.candidates, [], 'nothing left to report next run')
  })

  it('an order paid or cancelled by hand in the meantime is left alone', async () => {
    const { state, deps } = shop([crypto('A')], { changed: new Set(['A']) })
    assert.deepEqual(ok(await releaseExpiredReservations({ policy, deps })).changed, ['A'])
    assert.equal(state.shelf, 0)
  })

  it('a database error on one order does not stop the others, and is reported', async () => {
    const { state, deps } = shop([crypto('A'), crypto('B'), crypto('C')], { dbDown: new Set(['B']) })
    const r = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual(r.failed, ['B'])
    assert.deepEqual(r.released, ['A', 'C'])
    assert.equal(state.shelf, 2)
  })

  it('a cancellation whose restock failed is reported, then repaired by the next run — exactly once', async () => {
    const restockDown = new Set(['A'])
    const { state, deps } = shop([crypto('A'), crypto('B')], { restockDown })
    const first = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual(first.restockFailed, ['A'])
    assert.deepEqual(first.released, ['B'])
    assert.equal(state.shelf, 1)

    // Still down: reported again, nothing double-counted.
    const second = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual(second.restockFailed, ['A'])
    assert.equal(state.shelf, 1)

    restockDown.clear()
    const third = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual(third.restockRepaired, ['A'])
    assert.deepEqual(third.released, [])
    assert.equal(state.shelf, 2)

    const fourth = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual([fourth.released, fourth.restockRepaired, fourth.restockFailed], [[], [], []])
    assert.equal(state.shelf, 2, 'units go back once')
  })

  it('running twice releases nothing twice', async () => {
    const { state, deps } = shop([crypto('A'), card('B')])
    await releaseExpiredReservations({ policy, deps })
    const again = ok(await releaseExpiredReservations({ policy, deps }))
    assert.deepEqual([again.candidates, again.released], [[], []])
    assert.equal(state.shelf, 2)
  })

  it('a dry run touches nothing', async () => {
    const { state, deps } = shop([crypto('A'), card('B')])
    const r = ok(await releaseExpiredReservations({ policy, deps, dryRun: true }))
    assert.deepEqual(r.candidates, ['A', 'B'])
    assert.equal(state.stripeCalls + state.cancelCalls + state.shelf, 0)
  })

  it('unmigrated, switched off, or the listing itself failing', async () => {
    assert.deepEqual(await releaseExpiredReservations({ policy, deps: { listLapsed: async () => 'unmigrated' } }), { status: 'unmigrated' })
    assert.deepEqual(await releaseExpiredReservations({ policy: null }), { status: 'off' })
    await assert.rejects(releaseExpiredReservations({ policy, deps: { listLapsed: async () => { throw new Error('db down') } } }), /db down/)
  })
})

describe('ambiguous Stripe failures (refunds keep their claim)', () => {
  it('no answer, or a Stripe-side error: the outcome is unknown', () => {
    assert.equal(isAmbiguousStripeFailure({ type: 'StripeConnectionError' }), true)
    assert.equal(isAmbiguousStripeFailure({ type: 'StripeAPIError', statusCode: 500 }), true)
    assert.equal(isAmbiguousStripeFailure({ type: 'StripeInvalidRequestError', statusCode: 502 }), true)
    assert.equal(isAmbiguousStripeFailure(new Error('fetch failed')), true)
    assert.equal(isAmbiguousStripeFailure(null), true)
  })

  it('a definite refusal: nothing happened', () => {
    assert.equal(isAmbiguousStripeFailure({ type: 'StripeInvalidRequestError', statusCode: 400 }), false)
    assert.equal(isAmbiguousStripeFailure({ type: 'StripeCardError', statusCode: 402 }), false)
    assert.equal(isAmbiguousStripeFailure({ type: 'StripeRateLimitError', statusCode: 429 }), false)
    assert.equal(isAmbiguousStripeFailure({ type: 'StripeAuthenticationError', statusCode: 401 }), false)
  })
})

describe('payment reconciliation', () => {
  type O = Pick<Order, 'id' | 'total' | 'paymentStatus' | 'paymentProvider' | 'paymentId' | 'paymentCurrency' | 'paymentAmount' | 'refundedAmount'>
  const order = (id: string, over: Partial<O> = {}): O => ({
    id, total: 100, paymentStatus: 'paid', paymentProvider: 'stripe', paymentId: `pi_${id}`, paymentCurrency: 'CHF', paymentAmount: 100, refundedAmount: 0, ...over,
  })
  const pay = (id: string, over: Partial<ProviderPayment> = {}): ProviderPayment => ({
    id: `pi_${id}`, status: 'succeeded', currency: 'chf', amountReceived: 10000, amountRefunded: 0, orderId: id, ...over,
  })
  const kinds = (d: { kind: string }[]) => d.map((x) => x.kind).sort()

  it('everything matching → no discrepancies', () => {
    assert.deepEqual(reconcilePayments([order('A'), order('B', { paymentStatus: 'pending_payment' })], [pay('A'), pay('B', { status: 'requires_payment_method', amountReceived: 0 })]), [])
  })

  it('money in Stripe the order does not show', () => {
    assert.deepEqual(kinds(reconcilePayments([order('A', { paymentStatus: 'pending_payment' })], [pay('A')])), ['paid_not_recorded'])
  })

  it('unrecorded money that is short, or in another currency, is a mismatch — not "paid, not recorded"', () => {
    const unpaid = order('A', { paymentStatus: 'pending_payment' })
    assert.deepEqual(kinds(reconcilePayments([unpaid], [pay('A', { amountReceived: 9900 })])), ['amount_mismatch'])
    assert.deepEqual(kinds(reconcilePayments([unpaid], [pay('A', { currency: 'eur' })])), ['currency_mismatch'])
    // More than due still settles the order, as the webhook would.
    assert.deepEqual(kinds(reconcilePayments([unpaid], [pay('A', { amountReceived: 10100 })])), ['paid_not_recorded'])
  })

  it('a payment Stripe is still settling, which the order does not show', () => {
    assert.deepEqual(kinds(reconcilePayments([order('A', { paymentStatus: 'pending_payment' })], [pay('A', { status: 'processing', amountReceived: 0 })])), ['processing_not_recorded'])
    // Already "confirming": the order knows, nothing to report.
    assert.deepEqual(reconcilePayments([order('A', { paymentStatus: 'confirming' })], [pay('A', { status: 'processing', amountReceived: 0 })]), [])
  })

  it('an order marked paid that Stripe did not take', () => {
    assert.deepEqual(kinds(reconcilePayments([order('A')], [pay('A', { status: 'canceled', amountReceived: 0 })])), ['recorded_not_paid'])
    assert.deepEqual(kinds(reconcilePayments([order('A')], [])), ['recorded_not_paid'])
  })

  it('wrong amount or currency', () => {
    assert.deepEqual(kinds(reconcilePayments([order('A')], [pay('A', { amountReceived: 9999 })])), ['amount_mismatch'])
    assert.deepEqual(kinds(reconcilePayments([order('A')], [pay('A', { currency: 'eur' })])), ['currency_mismatch'])
  })

  it('a converted payment is compared in its own currency', () => {
    assert.deepEqual(reconcilePayments([order('A', { paymentCurrency: 'EUR', paymentAmount: 107 })], [pay('A', { currency: 'eur', amountReceived: 10700 })]), [])
  })

  it('refunds on one side only', () => {
    assert.deepEqual(kinds(reconcilePayments([order('A')], [pay('A', { amountRefunded: 3000 })])), ['refund_not_recorded'])
    assert.deepEqual(kinds(reconcilePayments([order('A', { paymentStatus: 'partially_refunded', refundedAmount: 30 })], [pay('A')])), ['refund_recorded_not_made'])
    assert.deepEqual(reconcilePayments([order('A', { paymentStatus: 'partially_refunded', refundedAmount: 30 })], [pay('A', { amountRefunded: 3000 })]), [])
  })

  it('a succeeded payment no order carries', () => {
    assert.deepEqual(kinds(reconcilePayments([], [pay('Z', { orderId: undefined })])), ['payment_without_order'])
    // An abandoned intent with no order is not money: not reported.
    assert.deepEqual(reconcilePayments([], [pay('Z', { status: 'requires_payment_method', amountReceived: 0 })]), [])
  })

  it('an older, failed intent of an order that was paid with a newer one is history', () => {
    assert.deepEqual(reconcilePayments([order('A', { paymentId: 'pi_new' })], [pay('A', { id: 'pi_old', status: 'canceled', amountReceived: 0 }), pay('A', { id: 'pi_new' })]), [])
  })

  it('a second succeeded intent for an order already paid by another is flagged', () => {
    assert.deepEqual(kinds(reconcilePayments([order('A', { paymentId: 'pi_new' })], [pay('A', { id: 'pi_other' }), pay('A', { id: 'pi_new' })])), ['payment_without_order'])
  })
})

describe('cron endpoints authenticate before doing anything', () => {
  it('bearer secret: exact match only', () => {
    assert.equal(hasBearerSecret('Bearer s3cret-value', 's3cret-value'), true)
    assert.equal(hasBearerSecret('Bearer s3cret-valuE', 's3cret-value'), false)
    assert.equal(hasBearerSecret('s3cret-value', 's3cret-value'), false)
    assert.equal(hasBearerSecret('Bearer ', 's3cret-value'), false)
    assert.equal(hasBearerSecret(null, 's3cret-value'), false)
    assert.equal(hasBearerSecret('Bearer anything', undefined), false)
    assert.equal(hasBearerSecret('Bearer ', ''), false)
  })

  it('/api/cron/reservations: 503 without CRON_SECRET, 401 with a wrong one — before touching the database', async () => {
    const { GET } = await import('@/app/api/cron/reservations/route')
    const saved = process.env.CRON_SECRET
    try {
      delete process.env.CRON_SECRET
      assert.equal((await GET(new NextRequest('https://shop.test/api/cron/reservations'))).status, 503)
      process.env.CRON_SECRET = 'cron-secret-for-tests'
      assert.equal((await GET(new NextRequest('https://shop.test/api/cron/reservations'))).status, 401)
      assert.equal((await GET(new NextRequest('https://shop.test/api/cron/reservations', { headers: { authorization: 'Bearer wrong' } }))).status, 401)
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = saved
    }
  })
})

describe('security event lines', () => {
  it('are JSON with known fields only, and never the raw address', async () => {
    const { securityEvent } = await import('@/lib/server/security-events')
    const saved = process.env.PAYMENT_FRAUD_SECRET
    process.env.PAYMENT_FRAUD_SECRET = 'test-key-for-hashing'
    const lines: string[] = []
    const warn = console.warn
    console.warn = (line: string) => lines.push(line)
    try {
      securityEvent('admin_login_failed', { ip: '203.0.113.77', reason: 'password' })
      securityEvent('admin_login_failed', { ip: '203.0.113.77', reason: 'password' })
    } finally {
      console.warn = warn
      if (saved === undefined) delete process.env.PAYMENT_FRAUD_SECRET
      else process.env.PAYMENT_FRAUD_SECRET = saved
    }
    const [a, b] = lines.map((l) => JSON.parse(l))
    assert.equal(a.security_event, 'admin_login_failed')
    assert.ok(!lines.join('').includes('203.0.113.77'), 'raw IP logged')
    assert.equal(a.source, b.source, 'the same source must hash the same, so repeats can be counted')
    assert.deepEqual(Object.keys(a).sort(), ['at', 'reason', 'security_event', 'source'])
  })
})

describe('which Stripe answers mean "this payment does not exist here"', () => {
  it('a 404 resource_missing does', () => {
    assert.equal(isMissingIntent({ type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404, message: "No such payment_intent: 'pi_1'" }), true)
    assert.equal(
      isMissingIntent({ code: 'resource_missing', statusCode: 404, message: "No such payment_intent: 'pi_1'; a similar object exists in test mode, but a live mode key was used to make this request." }),
      true,
    )
  })
  it('one that exists in LIVE mode (shop on test keys) does not: it could still take real money', () => {
    assert.equal(
      isMissingIntent({ code: 'resource_missing', statusCode: 404, message: "No such payment_intent: 'pi_1'; a similar object exists in live mode, but a test mode key was used to make this request." }),
      false,
    )
  })
  it('timeouts, 5xx, auth errors and anything unknown do not', () => {
    assert.equal(isMissingIntent({ type: 'StripeConnectionError', message: 'timeout' }), false)
    assert.equal(isMissingIntent({ type: 'StripeAPIError', statusCode: 500, message: 'oops' }), false)
    assert.equal(isMissingIntent({ type: 'StripeAuthenticationError', statusCode: 401, message: 'Invalid API Key' }), false)
    assert.equal(isMissingIntent(null), false)
    assert.equal(isMissingIntent(new Error('No such payment_intent')), false)
  })
})
