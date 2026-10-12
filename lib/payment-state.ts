import type { PaymentStatus } from '@/lib/types'

/**
 * The payment state machine: which statuses an order may move INTO a status
 * from. Enforced inside the UPDATE itself (a PostgREST filter on the current
 * payment_status), so two webhook deliveries racing each other cannot slip a
 * transition past it the way a read-then-write check could.
 *
 *   pending_payment / confirming / failed / expired
 *       only from an UNSETTLED order (or one with no status yet) — a late,
 *       duplicated or replayed event can never un-pay an order;
 *   paid
 *       from anything except a refund — paid → paid is an idempotent repeat;
 *   refunded / partially_refunded
 *       only from money that arrived (paid or partially refunded).
 */
const UNSETTLED_PAYMENT_STATUSES: PaymentStatus[] = ['pending_payment', 'confirming', 'failed', 'expired']

export function allowedPriorStatuses(target: PaymentStatus): { from: PaymentStatus[]; fromNull: boolean } {
  switch (target) {
    case 'paid':
      return { from: [...UNSETTLED_PAYMENT_STATUSES, 'paid'], fromNull: true }
    case 'refunded':
    case 'partially_refunded':
      return { from: ['paid', 'partially_refunded', 'refunded'], fromNull: false }
    default:
      return { from: UNSETTLED_PAYMENT_STATUSES, fromNull: true }
  }
}

/** The PostgREST `or` filter for allowedPriorStatuses. */
export function transitionFilter(target: PaymentStatus): string {
  const { from, fromNull } = allowedPriorStatuses(target)
  const inList = `payment_status.in.(${from.join(',')})`
  return fromNull ? `payment_status.is.null,${inList}` : inList
}

/** Whether a status transition is allowed — the same table, for callers that
 *  need to explain a refusal. */
export function isPaymentTransitionAllowed(from: PaymentStatus | null | undefined, to: PaymentStatus): boolean {
  const rule = allowedPriorStatuses(to)
  return from == null ? rule.fromNull : rule.from.indexOf(from) !== -1
}

/**
 * Payment statuses that mean money ARRIVED for the order at some point. Such
 * an order is never "unpaid" again, whatever happened to the money after:
 * a refund is recorded on top of the payment, it does not undo it.
 */
const MONEY_ARRIVED: PaymentStatus[] = ['paid', 'partially_refunded', 'refunded']

export function hasReceivedMoney(status: PaymentStatus | null | undefined): boolean {
  return status != null && MONEY_ARRIVED.indexOf(status) !== -1
}

/**
 * Cancelling an order — the customer's own button, or the admin setting
 * "cancelled" on an order nobody has paid for — releases its units, gives back
 * its promo-code use and writes payment_status 'expired'. That is only true to
 * the facts while no money has arrived and none is on its way:
 *
 *   payment   null, pending_payment, failed, expired — never paid, nothing
 *             in flight. NOT 'confirming' (a payment is settling and may
 *             land any moment) and NOT paid / partially_refunded / refunded
 *             (that needs a refund, which is an admin action).
 *   status    pending or processing — once a parcel has left, putting its
 *             units back on sale would sell stock that is in a van.
 *
 * The same rule rides inside the UPDATE as a filter (cancellationFilter), so
 * a webhook landing between the check and the write cannot be overwritten.
 */
const CANCELLABLE_PAYMENT: PaymentStatus[] = ['pending_payment', 'failed', 'expired']
export const CANCELLABLE_ORDER_STATUSES = ['pending', 'processing'] as const

export type CancelRefusal = 'already_cancelled' | 'money_received' | 'payment_in_flight' | 'already_fulfilled'

export function cancellationRefusal(order: {
  status: string
  paymentStatus?: PaymentStatus | null
}): CancelRefusal | null {
  if (order.status === 'cancelled') return 'already_cancelled'
  if (hasReceivedMoney(order.paymentStatus)) return 'money_received'
  if (order.status === 'refunded') return 'already_cancelled'
  if (order.paymentStatus === 'confirming') return 'payment_in_flight'
  if ((CANCELLABLE_ORDER_STATUSES as readonly string[]).indexOf(order.status) === -1) return 'already_fulfilled'
  return null
}

/** The PostgREST `or` filter for cancellationRefusal's payment half. */
export function cancellationFilter(): string {
  return `payment_status.is.null,payment_status.in.(${CANCELLABLE_PAYMENT.join(',')})`
}
