import 'server-only'

import { toMinor } from '@/lib/refunds/money'
import type { Actor } from '@/lib/refunds/types'
import { getOrderById } from '@/lib/server/orders-store'
import { newCorrelationId } from '@/lib/server/refunds/audit'
import { loadOrderFacts } from '@/lib/server/refunds/order-facts'
import { executeRefund } from '@/lib/server/refunds/payments'
import { applyLedgerOutcome } from '@/lib/server/refunds/workflow'
import type { Order } from '@/lib/types'

/**
 * A refund of an ORDER, outside any case: the admin's refund button on an
 * order (/api/admin/orders/[id]/refund) and the fraud guard's automatic
 * refund of an unshipped order (lib/server/payment-fraud.ts). A customer's
 * return goes through a case instead (lib/server/refunds/workflow.ts).
 *
 * Both now go through the same ledger as cases (lib/server/refunds/payments.ts):
 * reserved under the order's lock — never more than was paid, one refund in
 * flight at a time — then sent to Stripe with an idempotency key tied to the
 * ledger row, and recorded with what Stripe answered. The order's
 * refunded_amount and payment status are rebuilt from the ledger, never
 * written here.
 *
 * What it keeps from before: a card paid in EUR or USD is refunded in that
 * currency at the rate it was CHARGED at; the refund that completes the order
 * takes exactly what Stripe still holds.
 */

export type RefundResult =
  | {
      ok: true
      order: Order | null
      refundId?: string
      /** 'succeeded', or 'pending' while the card network processes it. */
      status: string
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
      reason: 'manual' | 'not_paid' | 'unconfigured' | 'stripe' | 'in_flight' | 'exceeds'
    }

/**
 * @param amount CHF, major units — the same unit as order.total. Omit to
 *               refund whatever remains unrefunded.
 */
export async function refundOrder(
  order: Order,
  amount: number | undefined,
  opts: { source: 'order_screen' | 'fraud_guard' | 'cancellation'; actor: Actor; reason: string; idempotencyKey?: string },
): Promise<RefundResult> {
  if (order.paymentProvider !== 'stripe' || !order.paymentId) {
    return { ok: false, reason: 'manual', message: 'Оплата прошла не через Stripe — верните средства вручную.' }
  }
  const facts = await loadOrderFacts({ number: order.id })
  if (!facts) return { ok: false, reason: 'not_paid', message: 'Заказ не найден' }
  if (facts.paymentStatus !== 'paid' && facts.paymentStatus !== 'partially_refunded') {
    return { ok: false, reason: 'not_paid', message: 'Возврат возможен только для оплаченного заказа' }
  }
  const remaining = facts.totalMinor - facts.committedMinor
  let amountMinor: number
  try {
    amountMinor = amount === undefined ? remaining : toMinor(amount.toFixed(2))
  } catch {
    return { ok: false, reason: 'exceeds', message: 'Некорректная сумма возврата' }
  }
  if (amountMinor <= 0) return { ok: false, reason: 'exceeds', message: 'По заказу нечего возвращать' }

  // One refund per ledger state, as before: the same request repeated (two
  // tabs, a retry) sees the same committed total and gets the same key — the
  // same ledger row, never a second refund. A deliberate later refund sees a
  // moved ledger and gets a new key.
  const key = opts.idempotencyKey ?? `${opts.source}:${facts.id}:${facts.committedMinor}:${amountMinor}`
  const result = await executeRefund({
    order: facts,
    amountMinor,
    source: opts.source,
    reason: opts.reason,
    actor: opts.actor,
    idempotencyKey: key,
    correlationId: newCorrelationId(),
  })
  if (result.row) await applyLedgerOutcome(result.row, opts.actor)

  if (!result.ok) {
    const reason: Extract<RefundResult, { ok: false }>['reason'] =
      result.code === 'stripe_unconfigured'
        ? 'unconfigured'
        : result.code === 'manual_method'
          ? 'manual'
          : result.code === 'ORDER_NOT_REFUNDABLE' || result.code === 'not_captured'
            ? 'not_paid'
            : result.code === 'REFUND_IN_FLIGHT' || result.code === 'in_progress'
              ? 'in_flight'
              : result.code === 'REFUND_EXCEEDS_BALANCE'
                ? 'exceeds'
                : 'stripe'
    return { ok: false, reason, message: result.message }
  }

  const after = await loadOrderFacts({ id: facts.id })
  return {
    ok: true,
    order: await getOrderById(order.id),
    refundId: result.row.providerRefundId,
    status: result.row.status,
    refunded: result.row.amountMinor / 100,
    totalRefunded: (after?.refundedMinor ?? 0) / 100,
    fullyRefunded: after?.paymentStatus === 'refunded',
  }
}
