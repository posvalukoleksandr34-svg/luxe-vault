import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isPaymentTransitionAllowed, transitionFilter } from '@/lib/payment-state'
import type { PaymentStatus } from '@/lib/types'

const UNSETTLED: PaymentStatus[] = ['pending_payment', 'confirming', 'failed', 'expired']

describe('payment state machine', () => {
  it('never un-pays an order: no unsettled status may follow paid or a refund', () => {
    for (const settled of ['paid', 'partially_refunded', 'refunded'] as PaymentStatus[]) {
      for (const target of UNSETTLED) {
        assert.equal(isPaymentTransitionAllowed(settled, target), false, `${settled} -> ${target}`)
      }
    }
  })

  it('a refund needs money that arrived', () => {
    for (const from of [null, ...UNSETTLED] as (PaymentStatus | null)[]) {
      assert.equal(isPaymentTransitionAllowed(from, 'refunded'), false, `${from} -> refunded`)
      assert.equal(isPaymentTransitionAllowed(from, 'partially_refunded'), false, `${from} -> partially_refunded`)
    }
    assert.equal(isPaymentTransitionAllowed('paid', 'refunded'), true)
    assert.equal(isPaymentTransitionAllowed('partially_refunded', 'refunded'), true)
  })

  it('a refunded order cannot be paid again by a replayed event', () => {
    assert.equal(isPaymentTransitionAllowed('refunded', 'paid'), false)
    assert.equal(isPaymentTransitionAllowed('partially_refunded', 'paid'), false)
  })

  it('paid is reachable from unsettled states and repeats idempotently', () => {
    for (const from of [null, ...UNSETTLED, 'paid'] as (PaymentStatus | null)[]) {
      assert.equal(isPaymentTransitionAllowed(from, 'paid'), true, `${from} -> paid`)
    }
  })

  it('the database filter matches the table', () => {
    assert.equal(transitionFilter('paid'), 'payment_status.is.null,payment_status.in.(pending_payment,confirming,failed,expired,paid)')
    assert.equal(transitionFilter('refunded'), 'payment_status.in.(paid,partially_refunded,refunded)')
    assert.equal(transitionFilter('failed'), 'payment_status.is.null,payment_status.in.(pending_payment,confirming,failed,expired)')
  })
})
