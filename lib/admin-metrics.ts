import { toMinor } from '@/lib/refunds/money'

/**
 * The dashboard's figures, computed on the server from every order (not the
 * newest N a list happens to load) and in rappen, so the totals are exact.
 *
 * REVENUE is money that arrived and stayed: orders whose payment settled
 * (paid, partially or fully refunded), minus what was refunded. An unpaid,
 * failed or expired order never counts, whatever its status; neither does a
 * cancelled one that was never paid. The AVERAGE ORDER is over paid orders,
 * before refunds — what customers spent per order.
 */

export type MetricsRow = {
  total: number | string
  refunded_amount: number | string | null
  status: string
  payment_status: string | null
  created_at: string
}

export type DashboardMetrics = {
  /** Paid minus refunded, all time. */
  netRevenueMinor: number
  /** The same for orders placed in the last 30 days. */
  netRevenue30dMinor: number
  refundedMinor: number
  paidOrders: number
  paidOrders30d: number
  /** Paid total ÷ paid orders, before refunds; 0 with no paid order. */
  avgOrderMinor: number
  /** Paid, not yet shipped. */
  awaitingShipment: number
  /** Placed, payment not settled (pending or confirming), not cancelled. */
  awaitingPayment: number
  orders: number
}

const SETTLED = new Set(['paid', 'partially_refunded', 'refunded'])

/** The money arrived (and may since have been partly or fully refunded). */
export function isSettled(paymentStatus: string | null | undefined): boolean {
  return SETTLED.has(paymentStatus ?? '')
}
const UNSETTLED = new Set(['pending_payment', 'confirming'])
const DAY = 24 * 60 * 60 * 1000

/** numeric(12,2) CHF → rappen, exactly (no float sums); a missing value is 0. */
function minor(value: number | string | null | undefined): number {
  return value === null || value === undefined || value === '' ? 0 : toMinor(value)
}

export function summarizeOrders(rows: readonly MetricsRow[], now: number): DashboardMetrics {
  const out: DashboardMetrics = {
    netRevenueMinor: 0,
    netRevenue30dMinor: 0,
    refundedMinor: 0,
    paidOrders: 0,
    paidOrders30d: 0,
    avgOrderMinor: 0,
    awaitingShipment: 0,
    awaitingPayment: 0,
    orders: rows.length,
  }
  let grossPaid = 0
  for (const r of rows) {
    const payment = r.payment_status ?? ''
    if (isSettled(payment)) {
      const total = minor(r.total)
      const refunded = Math.min(total, minor(r.refunded_amount))
      const recent = now - Date.parse(r.created_at) <= 30 * DAY
      grossPaid += total
      out.paidOrders++
      out.netRevenueMinor += total - refunded
      out.refundedMinor += refunded
      if (recent) {
        out.paidOrders30d++
        out.netRevenue30dMinor += total - refunded
      }
      if (payment === 'paid' && (r.status === 'pending' || r.status === 'processing')) out.awaitingShipment++
    } else if (UNSETTLED.has(payment) && r.status !== 'cancelled') {
      out.awaitingPayment++
    }
  }
  out.avgOrderMinor = out.paidOrders > 0 ? Math.round(grossPaid / out.paidOrders) : 0
  return out
}
