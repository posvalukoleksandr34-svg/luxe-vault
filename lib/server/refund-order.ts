import 'server-only'

import { orderChargeRate } from '@/lib/currency'
import { recordRefund } from '@/lib/server/orders-store'
import { isStripeConfigured, refundPayment } from '@/lib/server/stripe'
import type { Order } from '@/lib/types'

/**
 * Gives a customer their money back through Stripe, and records it.
 *
 * ONE IMPLEMENTATION, TWO CALLERS: the admin's refund button on an order
 * (/api/admin/orders/[id]/refund) and approving a return
 * (/api/admin/returns/[id]). They used to be one inline block in the first,
 * and a second copy would have been the classic way for the two to drift —
 * one of them rounding a currency conversion differently, or recording the
 * refunded amount incrementally where the other records it cumulatively.
 *
 * What it inherits unchanged from that block:
 *
 *   * Stripe is the source of truth for what is left to refund. refundPayment
 *     reads the remaining balance from the charge, so a retried or concurrent
 *     refund cannot return more than was captured — and Stripe itself refuses
 *     a refund larger than the charge's remainder at creation time, which is
 *     the last line under both.
 *   * A card paid in EUR or USD is refunded in that currency at the rate it
 *     was CHARGED at, never today's.
 *   * The recorded amount is cumulative, not incremental: adding to the stored
 *     value would double count if a caller were retried after Stripe succeeded
 *     but before the row was written.
 */

export type RefundResult =
  | {
      ok: true
      order: Order | null
      refundId: string
      /** CHF, major units — this refund alone. */
      refunded: number
      /** CHF, major units — everything refunded on this order so far. */
      totalRefunded: number
      fullyRefunded: boolean
    }
  | {
      ok: false
      /** Why, in the admin's own language: this is shown to a manager. */
      message: string
      /** `manual` means the payment did not go through Stripe at all and has
       *  to be returned by hand (a crypto payment, say). Not an error. */
      reason: 'manual' | 'not_paid' | 'unconfigured' | 'stripe'
    }

/**
 * @param amount CHF, major units — the same unit as order.total. Omit to
 *               refund whatever remains unrefunded.
 */
export async function refundOrder(order: Order, amount?: number): Promise<RefundResult> {
  if (order.paymentProvider !== 'stripe' || !order.paymentId) {
    return {
      ok: false,
      reason: 'manual',
      message: 'Оплата прошла не через Stripe — верните средства вручную.',
    }
  }
  if (!isStripeConfigured()) {
    return { ok: false, reason: 'unconfigured', message: 'Stripe не настроен' }
  }
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'partially_refunded') {
    return {
      ok: false,
      reason: 'not_paid',
      message: 'Возврат возможен только для оплаченного заказа',
    }
  }

  const result = await refundPayment(order.paymentId, amount, orderChargeRate(order))
  if (!result.ok) return { ok: false, reason: 'stripe', message: result.message }

  // Cumulative, not incremental — see the note above. A full refund records
  // the whole total, so converting back from another currency can never
  // leave a stray cent looking unrefunded.
  const totalRefunded = result.fullyRefunded
    ? order.total
    : Math.min(order.total, Number(((order.refundedAmount ?? 0) + result.amountRefunded).toFixed(2)))

  const updated = await recordRefund(order.id, {
    refundedAmount: totalRefunded,
    // Trust Stripe's view of whether anything is left, not our arithmetic.
    fully: result.fullyRefunded,
    refundId: result.refundId,
  })

  return {
    ok: true,
    order: updated,
    refundId: result.refundId,
    refunded: result.amountRefunded,
    totalRefunded,
    fullyRefunded: result.fullyRefunded,
  }
}
