import type { PolicyConfig } from '@/lib/refunds/policy'
import {
  CLAIM_TYPES,
  SELLER_FAULT_CLAIMS,
  WITHDRAWAL_CLAIMS,
  type ClaimType,
  type Resolution,
} from '@/lib/refunds/types'

/**
 * Whether, and how, an order can be claimed against — computed on the SERVER
 * from the order's own record and the policy in force, never taken from the
 * browser. The customer's form shows the result; the route recomputes it on
 * submission.
 *
 * Three answers per claim type, not two:
 *   allowed      — the customer can file it;
 *   manualReview — they can file it, and a person must look before anything
 *                  is decided (late, delivery date unknown, marked delivered);
 *   refused      — with a reason the customer is shown.
 * Late fault claims are NEVER refused on the date alone: the published 14 days
 * are a notice period, and statutory rights for faulty goods outlast them.
 */

export type EligibilityOrder = {
  paymentStatus: string | null | undefined
  status: string
  createdAt: number
  shippedAt?: number
  deliveredAt?: number
  /** Latest day the parcel was expected, from the order's estimate. */
  expectedDeliveryBy?: number
  trackingNumber?: string
  totalMinor: number
  /** Succeeded + in-flight refunds already against the order. */
  committedRefundMinor: number
  lines: EligibilityLine[]
}

export type EligibilityLine = {
  orderItemId: string
  productSlug: string
  categorySlug?: string
  name: string
  qty: number
  /** Units already held by other live or settled cases. */
  claimedQty: number
}

export type ClaimRefusal =
  | 'not_paid'
  | 'fully_refunded'
  | 'cancelled'
  | 'disabled'
  | 'not_dispatched'
  | 'already_dispatched'
  | 'withdrawal_window_closed'
  | 'nothing_left_to_claim'
  | 'no_returnable_items'

export type ManualReviewReason =
  | 'outside_fault_window'
  | 'late_non_delivery_report'
  | 'delivery_date_unknown'
  | 'marked_delivered'
  | 'other_claim'

export type ClaimEligibility = {
  type: ClaimType
  allowed: boolean
  refused?: ClaimRefusal
  manualReview: ManualReviewReason[]
  requireReturn: boolean
  resolutions: Resolution[]
  minPhotos: number
  /** The window this claim type closes at, when it has one (ms). */
  deadline?: number
  /** A non-delivery claim filed before this is held until it passes. */
  waitUntil?: number
  /** Lines this claim may include, with how many units of each. */
  lines: { orderItemId: string; available: number }[]
}

export type OrderEligibility = {
  eligible: boolean
  refused?: ClaimRefusal
  claims: Record<ClaimType, ClaimEligibility>
  lines: (EligibilityLine & { available: number; nonReturnable: boolean })[]
}

const DAY = 86_400_000

export function evaluateEligibility(order: EligibilityOrder, policy: PolicyConfig, now: number): OrderEligibility {
  const lines = order.lines.map((line) => ({
    ...line,
    available: Math.max(0, line.qty - line.claimedQty),
    nonReturnable:
      policy.restrictions.nonReturnableProductSlugs.includes(line.productSlug) ||
      (line.categorySlug ? policy.restrictions.nonReturnableCategorySlugs.includes(line.categorySlug) : false),
  }))

  const orderRefusal = orderLevelRefusal(order, lines)
  const claims = {} as Record<ClaimType, ClaimEligibility>
  for (const type of CLAIM_TYPES) {
    claims[type] = evaluateClaim(type, order, lines, policy, now, orderRefusal)
  }
  const eligible = CLAIM_TYPES.some((type) => claims[type].allowed)
  return { eligible, refused: eligible ? undefined : orderRefusal ?? 'nothing_left_to_claim', claims, lines }
}

function orderLevelRefusal(
  order: EligibilityOrder,
  lines: { available: number }[],
): ClaimRefusal | undefined {
  if (order.status === 'cancelled') return 'cancelled'
  if (order.paymentStatus === 'refunded' || (order.totalMinor > 0 && order.committedRefundMinor >= order.totalMinor)) {
    return 'fully_refunded'
  }
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'partially_refunded') return 'not_paid'
  if (lines.every((l) => l.available === 0)) return 'nothing_left_to_claim'
  return undefined
}

function evaluateClaim(
  type: ClaimType,
  order: EligibilityOrder,
  lines: (EligibilityLine & { available: number; nonReturnable: boolean })[],
  policy: PolicyConfig,
  now: number,
  orderRefusal: ClaimRefusal | undefined,
): ClaimEligibility {
  const rule = policy.claims[type]
  const base: ClaimEligibility = {
    type,
    allowed: false,
    manualReview: [],
    requireReturn: rule.requireReturn,
    resolutions: [...rule.allowedResolutions],
    minPhotos: rule.minPhotos,
    lines: [],
  }
  if (orderRefusal) return { ...base, refused: orderRefusal }
  if (!rule.enabled) return { ...base, refused: 'disabled' }

  const dispatched = order.shippedAt !== undefined || ['shipped', 'delivered', 'refunded'].includes(order.status)
  const withdrawal = WITHDRAWAL_CLAIMS.includes(type)
  const claimLines = lines
    .filter((l) => l.available > 0 && !(withdrawal && l.nonReturnable))
    .map((l) => ({ orderItemId: l.orderItemId, available: l.available }))
  if (claimLines.length === 0) {
    return { ...base, refused: withdrawal ? 'no_returnable_items' : 'nothing_left_to_claim' }
  }
  const out: ClaimEligibility = { ...base, lines: claimLines }

  if (type === 'cancel_before_dispatch') {
    if (dispatched) return { ...out, refused: 'already_dispatched' }
    return { ...out, allowed: true }
  }
  if (!dispatched) return { ...out, refused: 'not_dispatched' }

  // The date the customer had the parcel, or our best stand-in for it.
  const deliveredOn = order.deliveredAt
  const reference = deliveredOn ?? order.expectedDeliveryBy ?? order.shippedAt ?? order.createdAt

  if (type === 'non_delivery') {
    if (deliveredOn !== undefined) out.manualReview.push('marked_delivered')
    const expectedBy = order.expectedDeliveryBy ?? (order.shippedAt ?? order.createdAt) + 10 * DAY
    const waitUntil = expectedBy + policy.windows.deliveryGraceDays * DAY
    if (deliveredOn === undefined && now < waitUntil) out.waitUntil = waitUntil
    const since = order.shippedAt ?? order.createdAt
    out.deadline = since + policy.windows.nonDeliveryReportMaxDays * DAY
    if (now > out.deadline) out.manualReview.push('late_non_delivery_report')
    return { ...out, allowed: true }
  }

  if (deliveredOn === undefined) out.manualReview.push('delivery_date_unknown')

  if (SELLER_FAULT_CLAIMS.includes(type)) {
    out.deadline = reference + policy.windows.faultReportDays * DAY
    if (now > out.deadline) out.manualReview.push('outside_fault_window')
    return { ...out, allowed: true }
  }

  if (withdrawal) {
    out.deadline = reference + policy.windows.withdrawalDays * DAY
    if (now > out.deadline) return { ...out, refused: 'withdrawal_window_closed' }
    return { ...out, allowed: true }
  }

  // 'other': always a person's call.
  out.manualReview.push('other_claim')
  return { ...out, allowed: true }
}
