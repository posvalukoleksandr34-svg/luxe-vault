import { orderCharge, orderChargeRate, toMinorUnits } from '@/lib/currency'
import type { Order, PaymentStatus } from '@/lib/types'

/**
 * Compares what Stripe says happened with what the shop's orders record.
 * Pure: no provider or database calls — the caller fetches both sides
 * (lib/server/reconciliation.ts), so this can be tested with plain data.
 *
 * It never corrects anything. Every discrepancy is for a person to look at in
 * the Stripe dashboard and the admin console. The one correction the console
 * offers — recording a `paid_not_recorded` order as paid — is the owner's
 * decision, per order, and re-checks the payment with Stripe first
 * (app/api/admin/reconciliation/apply/route.ts).
 */

/** The parts of a Stripe PaymentIntent the comparison needs. */
export type ProviderPayment = {
  id: string
  status: string
  currency: string
  /** Minor units actually received. */
  amountReceived: number
  /** Minor units refunded on the latest charge. */
  amountRefunded: number
  /** metadata.orderId, when the intent was made by the shop. */
  orderId?: string
}

export type DiscrepancyKind =
  | 'paid_not_recorded'
  /** Stripe is still settling it (a bank debit, Klarna); the order does not know. */
  | 'processing_not_recorded'
  | 'recorded_not_paid'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'refund_not_recorded'
  | 'refund_recorded_not_made'
  | 'payment_without_order'

export type Discrepancy = {
  kind: DiscrepancyKind
  orderId?: string
  paymentId: string
  detail: string
}

const MONEY_IN: PaymentStatus[] = ['paid', 'partially_refunded', 'refunded']

/** Tolerance for the refund comparison: the order stores CHF, Stripe the
 *  charged currency, so a converted figure can differ by a cent. */
const REFUND_TOLERANCE_MINOR = 1

export function reconcilePayments(
  orders: Pick<Order, 'id' | 'total' | 'paymentStatus' | 'paymentProvider' | 'paymentId' | 'paymentCurrency' | 'paymentAmount' | 'refundedAmount'>[],
  payments: ProviderPayment[],
): Discrepancy[] {
  const out: Discrepancy[] = []
  const byPayment = new Map(orders.filter((o) => o.paymentId).map((o) => [o.paymentId as string, o]))
  const byOrder = new Map(orders.map((o) => [o.id, o]))

  for (const p of payments) {
    const order = byPayment.get(p.id) ?? (p.orderId ? byOrder.get(p.orderId) : undefined)
    const succeeded = p.status === 'succeeded'

    if (!order) {
      // Only money matters here: an abandoned intent with no order is noise.
      if (succeeded) {
        out.push({ kind: 'payment_without_order', paymentId: p.id, orderId: p.orderId, detail: `${p.amountReceived} ${p.currency.toUpperCase()} received; no order carries this payment` })
      }
      continue
    }

    // An order points at its CURRENT payment. An older intent of the same
    // order that never succeeded is history, not a discrepancy.
    if (order.paymentId && order.paymentId !== p.id) {
      if (succeeded) {
        out.push({ kind: 'payment_without_order', paymentId: p.id, orderId: order.id, detail: `succeeded, but ${order.id} is attached to ${order.paymentId}` })
      }
      continue
    }

    const recordedIn = MONEY_IN.indexOf(order.paymentStatus as PaymentStatus) !== -1
    const charge = orderCharge(order)
    const due = toMinorUnits(charge.amount)
    if (succeeded && !recordedIn) {
      // Unrecorded money is "paid, not recorded" only if it is the order's
      // money: the right currency, and at least the amount due — the same
      // test the webhook applies before marking an order paid. Anything less
      // is a mismatch, which no button may settle.
      const detail = `Stripe: succeeded; order: ${order.paymentStatus ?? 'no status'}`
      if (p.currency.toUpperCase() !== charge.currency) {
        out.push({ kind: 'currency_mismatch', orderId: order.id, paymentId: p.id, detail: `${detail}; Stripe ${p.currency.toUpperCase()}, order ${charge.currency}` })
      } else if (!(due > 0) || p.amountReceived < due) {
        out.push({ kind: 'amount_mismatch', orderId: order.id, paymentId: p.id, detail: `${detail}; received ${p.amountReceived}, order requires ${due} (minor units)` })
      } else {
        out.push({ kind: 'paid_not_recorded', orderId: order.id, paymentId: p.id, detail })
      }
      continue
    }
    if (p.status === 'processing' && !recordedIn && order.paymentStatus !== 'confirming') {
      out.push({ kind: 'processing_not_recorded', orderId: order.id, paymentId: p.id, detail: `Stripe: processing; order: ${order.paymentStatus ?? 'no status'}` })
      continue
    }
    if (!succeeded) {
      if (recordedIn) {
        out.push({ kind: 'recorded_not_paid', orderId: order.id, paymentId: p.id, detail: `order: ${order.paymentStatus}; Stripe: ${p.status}` })
      }
      continue
    }

    if (p.currency.toUpperCase() !== charge.currency) {
      out.push({ kind: 'currency_mismatch', orderId: order.id, paymentId: p.id, detail: `Stripe ${p.currency.toUpperCase()}, order ${charge.currency}` })
      continue
    }
    if (p.amountReceived !== due) {
      out.push({ kind: 'amount_mismatch', orderId: order.id, paymentId: p.id, detail: `received ${p.amountReceived}, order requires ${due} (minor units)` })
    }

    const recordedRefund = toMinorUnits((order.refundedAmount ?? 0) * orderChargeRate(order))
    if (p.amountRefunded > recordedRefund + REFUND_TOLERANCE_MINOR) {
      out.push({ kind: 'refund_not_recorded', orderId: order.id, paymentId: p.id, detail: `Stripe refunded ${p.amountRefunded}, order records ${recordedRefund} (minor units)` })
    } else if (recordedRefund > p.amountRefunded + REFUND_TOLERANCE_MINOR) {
      out.push({ kind: 'refund_recorded_not_made', orderId: order.id, paymentId: p.id, detail: `order records ${recordedRefund}, Stripe refunded ${p.amountRefunded} (minor units)` })
    }
  }

  // Orders the shop believes were paid by card, with no payment in the window
  // Stripe returned: only meaningful when the caller passes orders from the
  // same window, which lib/server/reconciliation.ts does.
  const seen = new Set(payments.map((p) => p.id))
  for (const o of orders) {
    if (o.paymentProvider !== 'stripe' || !o.paymentId) continue
    if (MONEY_IN.indexOf(o.paymentStatus as PaymentStatus) === -1) continue
    if (!seen.has(o.paymentId)) {
      out.push({ kind: 'recorded_not_paid', orderId: o.id, paymentId: o.paymentId, detail: `order: ${o.paymentStatus}; Stripe returned no such payment in the window` })
    }
  }
  return out
}
