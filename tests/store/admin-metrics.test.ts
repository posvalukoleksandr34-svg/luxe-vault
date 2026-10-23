import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { summarizeOrders, type MetricsRow } from '@/lib/admin-metrics'

const NOW = Date.parse('2026-10-22T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const row = (over: Partial<MetricsRow>): MetricsRow => ({
  total: '100.00',
  refunded_amount: 0,
  status: 'delivered',
  payment_status: 'paid',
  created_at: daysAgo(1),
  ...over,
})

describe('dashboard figures', () => {
  it('revenue is money that arrived and stayed: unpaid, failed and expired orders never count', () => {
    const m = summarizeOrders(
      [
        row({ total: '694.99' }),
        row({ total: 300, payment_status: 'pending_payment', status: 'pending' }),
        row({ total: 300, payment_status: 'failed', status: 'pending' }),
        row({ total: 300, payment_status: 'expired', status: 'cancelled' }),
      ],
      NOW,
    )
    assert.equal(m.netRevenueMinor, 69499)
    assert.equal(m.paidOrders, 1)
    assert.equal(m.orders, 4)
  })

  it('refunds are subtracted, partial and full; amounts are exact in rappen', () => {
    const m = summarizeOrders(
      [
        row({ total: '0.10' }),
        row({ total: '0.20' }),
        row({ total: '200.00', refunded_amount: '50.05', payment_status: 'partially_refunded' }),
        row({ total: '99.99', refunded_amount: '99.99', payment_status: 'refunded', status: 'refunded' }),
      ],
      NOW,
    )
    assert.equal(m.netRevenueMinor, 10 + 20 + 14995)
    assert.equal(m.refundedMinor, 5005 + 9999)
    assert.equal(m.paidOrders, 4)
    // The average is what customers spent per paid order, before refunds.
    assert.equal(m.avgOrderMinor, Math.round((10 + 20 + 20000 + 9999) / 4))
  })

  it('a refund recorded above the total never makes revenue negative', () => {
    assert.equal(summarizeOrders([row({ total: '10.00', refunded_amount: '12.00', payment_status: 'refunded' })], NOW).netRevenueMinor, 0)
  })

  it('the 30-day figures cover orders placed in the last 30 days only', () => {
    const m = summarizeOrders([row({ created_at: daysAgo(29) }), row({ created_at: daysAgo(31) })], NOW)
    assert.equal(m.netRevenue30dMinor, 10000)
    assert.equal(m.paidOrders30d, 1)
    assert.equal(m.netRevenueMinor, 20000)
  })

  it('counts the work waiting: paid but not shipped, and placed but not yet paid', () => {
    const m = summarizeOrders(
      [
        row({ status: 'processing' }),
        row({ status: 'pending' }),
        row({ status: 'shipped' }),
        row({ status: 'pending', payment_status: 'partially_refunded', refunded_amount: '10.00' }),
        row({ status: 'pending', payment_status: 'pending_payment' }),
        row({ status: 'pending', payment_status: 'confirming' }),
        row({ status: 'cancelled', payment_status: 'pending_payment' }),
      ],
      NOW,
    )
    assert.equal(m.awaitingShipment, 2)
    assert.equal(m.awaitingPayment, 2)
  })

  it('no paid orders: averages are 0, not NaN', () => {
    const m = summarizeOrders([], NOW)
    assert.equal(m.avgOrderMinor, 0)
    assert.equal(m.netRevenueMinor, 0)
  })
})
