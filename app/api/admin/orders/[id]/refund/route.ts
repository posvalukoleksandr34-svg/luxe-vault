import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById, recordRefund } from '@/lib/server/orders-store'
import { isStripeConfigured, refundPayment } from '@/lib/server/stripe'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/**
 * Full or partial refund of a paid order.
 *
 * ADMIN-ONLY, DELIBERATELY.
 *
 * A customer-facing refund button would let anyone order, receive the goods,
 * and refund themselves — the money leaves before any human looks at it. This
 * follows the precedent already set for returns in migration 0004: a customer
 * may *request*, and approving or refunding stays with the service role.
 *
 * Body:
 *   amount?: number   Major units (same as order.total). Omit for a full
 *                     refund of whatever remains unrefunded.
 *
 * Stripe is the source of truth for how much is left to refund — the
 * remaining balance is read from its ledger, not from our row, so two
 * concurrent requests cannot together return more than was captured.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe не настроен' }, { status: 503 })
  }

  let body: { amount?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    // Empty body means a full refund.
  }

  let amount: number | undefined
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    const parsed = typeof body.amount === 'number' ? body.amount : Number(body.amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: 'Некорректная сумма возврата' }, { status: 400 })
    }
    amount = parsed
  }

  const order = await getOrderById(params.id)
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  if (order.paymentProvider !== 'stripe' || !order.paymentId) {
    return NextResponse.json(
      { error: 'Возврат через Stripe недоступен для этого заказа' },
      { status: 400 },
    )
  }
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'partially_refunded') {
    return NextResponse.json(
      { error: 'Возврат возможен только для оплаченного заказа' },
      { status: 409 },
    )
  }

  const result = await refundPayment(order.paymentId, amount)
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }

  // Cumulative, not incremental: adding to the stored value would double count
  // if this route were retried after Stripe succeeded but before we wrote.
  const cumulative = Number(((order.refundedAmount ?? 0) + result.amountRefunded).toFixed(2))

  const updated = await recordRefund(params.id, {
    refundedAmount: cumulative,
    // Trust Stripe's view of whether anything is left, not our arithmetic.
    fully: result.fullyRefunded,
    refundId: result.refundId,
  })

  return NextResponse.json({
    order: updated,
    refundId: result.refundId,
    refunded: result.amountRefunded,
    totalRefunded: cumulative,
    fullyRefunded: result.fullyRefunded,
  })
}
