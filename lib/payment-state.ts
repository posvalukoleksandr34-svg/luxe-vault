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
