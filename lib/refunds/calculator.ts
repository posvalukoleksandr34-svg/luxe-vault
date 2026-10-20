import { allocate, assertMinor, sumMinor } from '@/lib/refunds/money'
import type { PolicyConfig } from '@/lib/refunds/policy'
import { SELLER_FAULT_CLAIMS, WITHDRAWAL_CLAIMS, type ClaimType } from '@/lib/refunds/types'

/**
 * What a claim is worth — the ONE place a refund amount is computed.
 *
 * Inputs are the order's own record (prices, quantities, discount, shipping,
 * tax as charged) and the ledger; nothing comes from the browser. Everything
 * is integer minor units.
 *
 * HOW AN ORDER'S MONEY IS SPLIT (lib/server/order-drafts.ts builds it the same
 * way): total = (subtotal − discount) + shipping + tax, tax charged on the
 * discounted goods and on shipping.
 *
 *   * The order-level discount is shared across the lines in proportion to
 *     their value (allocate(): integers that sum exactly). A coupon limited to
 *     some products (0057) gave its discount only to those lines, but the
 *     order does not record which — proportional is the documented
 *     approximation, and the approving manager can adjust within the cap.
 *   * Tax is shared the same way across the discounted lines and shipping.
 *   * A line's units each carry an equal share of that line's net value.
 *   * The original delivery charge comes back when the policy says so: the
 *     whole order withdrawn (Policy §6), a seller-fault claim covering every
 *     remaining unit, or a cancellation before dispatch — once per order.
 *
 * The result is CAPPED by what is still refundable on the order (paid total −
 * succeeded − in flight). The database enforces the same cap again under a
 * lock when the money moves (reserve_refund_transaction); this cap is what the
 * manager is shown.
 */

export type CalcOrder = {
  subtotalMinor: number
  discountMinor: number
  shippingMinor: number
  taxMinor: number
  totalMinor: number
  lines: { orderItemId: string; qty: number; unitPriceMinor: number }[]
}

export type CalcInput = {
  order: CalcOrder
  claimType: ClaimType
  selection: { orderItemId: string; qty: number }[]
  policy: PolicyConfig
  /** Units of each line already covered by OTHER live or settled cases. */
  claimedElsewhere: Record<string, number>
  /** A previous case already returned the delivery charge. */
  shippingAlreadyRefunded: boolean
  /** Succeeded + in-flight refunds against the order. */
  committedMinor: number
  /** Loss of value under Policy §3, entered by staff with a reason. */
  deductionMinor?: number
  /** Return postage the customer paid on a seller-fault claim, from their
   *  receipt (Policy §7: postage both ways). */
  returnPostageMinor?: number
  /** Staff override of the shipping rule (with a reason, recorded). */
  includeShipping?: boolean
}

export type CalcLine = {
  orderItemId: string
  qty: number
  grossMinor: number
  discountMinor: number
  taxMinor: number
  netMinor: number
}

export type CalcWarning =
  | 'capped_to_refundable_balance'
  | 'postage_exceeds_balance'
  | 'discount_shared_proportionally'
  | 'deduction_exceeds_value'
  | 'nothing_refundable'

export type CalcResult = {
  lines: CalcLine[]
  itemsMinor: number
  shippingMinor: number
  returnPostageMinor: number
  deductionMinor: number
  /** Before the cap. */
  computedMinor: number
  /** Still refundable on the order. */
  refundableBalanceMinor: number
  /** What may be refunded: min(computed, balance). */
  totalMinor: number
  includesShipping: boolean
  warnings: CalcWarning[]
}

export type CalculationErrorCode = 'unknown_line' | 'invalid_quantity' | 'exceeds_available' | 'empty_selection'

export class CalculationError extends Error {
  readonly code: CalculationErrorCode
  constructor(code: CalculationErrorCode) {
    super(code)
    this.code = code
  }
}

export function calculateRefund(input: CalcInput): CalcResult {
  const { order } = input
  const warnings: CalcWarning[] = []
  for (const v of [order.subtotalMinor, order.discountMinor, order.shippingMinor, order.taxMinor, order.totalMinor, input.committedMinor]) {
    assertMinor(v)
  }
  if (input.selection.length === 0) throw new CalculationError('empty_selection')

  // Every line's share of the order's discount and tax, for the whole order.
  const gross = order.lines.map((l) => l.unitPriceMinor * l.qty)
  for (const g of gross) assertMinor(g)
  const discounts = allocate(Math.min(order.discountMinor, sumMinor(gross)), gross)
  const nets = gross.map((g, i) => g - discounts[i])
  const taxShares = allocate(order.taxMinor, [...nets, order.shippingMinor])
  const shippingTax = taxShares[nets.length]
  if (order.discountMinor > 0) warnings.push('discount_shared_proportionally')

  const byId = new Map(order.lines.map((l, i) => [l.orderItemId, i]))
  const lines: CalcLine[] = []
  let unitsSelected = 0
  for (const pick of input.selection) {
    const i = byId.get(pick.orderItemId)
    if (i === undefined) throw new CalculationError('unknown_line')
    if (!Number.isInteger(pick.qty) || pick.qty <= 0) throw new CalculationError('invalid_quantity')
    const line = order.lines[i]
    const elsewhere = input.claimedElsewhere[pick.orderItemId] ?? 0
    if (pick.qty + elsewhere > line.qty) throw new CalculationError('exceeds_available')

    // This claim's units of the line: the shares AFTER those other claims
    // already hold, so two claims on one line never both take the odd rappen.
    const split = [elsewhere, pick.qty, line.qty - elsewhere - pick.qty]
    const gross_ = allocate(gross[i], split)[1]
    const discount_ = allocate(discounts[i], split)[1]
    const tax_ = allocate(taxShares[i], split)[1]
    lines.push({
      orderItemId: pick.orderItemId,
      qty: pick.qty,
      grossMinor: gross_,
      discountMinor: discount_,
      taxMinor: tax_,
      netMinor: gross_ - discount_ + tax_,
    })
    unitsSelected += pick.qty
  }
  const itemsMinor = sumMinor(lines.map((l) => l.netMinor))

  // Does this claim, with everything already claimed, cover every unit?
  const unitsOrdered = order.lines.reduce((a, l) => a + l.qty, 0)
  const unitsElsewhere = order.lines.reduce((a, l) => a + Math.min(l.qty, input.claimedElsewhere[l.orderItemId] ?? 0), 0)
  const coversWholeOrder = unitsSelected + unitsElsewhere >= unitsOrdered

  let includesShipping = false
  if (input.includeShipping !== undefined) {
    includesShipping = input.includeShipping
  } else if (input.claimType === 'cancel_before_dispatch') {
    includesShipping = true
  } else if (SELLER_FAULT_CLAIMS.includes(input.claimType)) {
    includesShipping = input.policy.shipping.refundOnSellerFault && coversWholeOrder
  } else if (WITHDRAWAL_CLAIMS.includes(input.claimType)) {
    includesShipping = input.policy.shipping.refundOnFullWithdrawal && coversWholeOrder
  }
  if (input.shippingAlreadyRefunded) includesShipping = false
  const shippingMinor = includesShipping ? order.shippingMinor + shippingTax : 0

  const returnPostageMinor = input.returnPostageMinor ?? 0
  assertMinor(returnPostageMinor)
  let deductionMinor = input.deductionMinor ?? 0
  assertMinor(deductionMinor)
  const before = itemsMinor + shippingMinor + returnPostageMinor
  if (deductionMinor > before) {
    warnings.push('deduction_exceeds_value')
    deductionMinor = before
  }
  const computedMinor = before - deductionMinor

  const refundableBalanceMinor = Math.max(0, order.totalMinor - input.committedMinor)
  let totalMinor = computedMinor
  if (totalMinor > refundableBalanceMinor) {
    totalMinor = refundableBalanceMinor
    warnings.push(returnPostageMinor > 0 ? 'postage_exceeds_balance' : 'capped_to_refundable_balance')
  }
  if (totalMinor === 0) warnings.push('nothing_refundable')

  return {
    lines,
    itemsMinor,
    shippingMinor,
    returnPostageMinor,
    deductionMinor,
    computedMinor,
    refundableBalanceMinor,
    totalMinor,
    includesShipping,
    warnings,
  }
}
