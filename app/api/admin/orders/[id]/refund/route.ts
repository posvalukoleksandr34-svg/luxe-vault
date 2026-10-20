import { NextResponse, type NextRequest } from 'next/server'
import { toMinor } from '@/lib/refunds/money'
import { getOrderById } from '@/lib/server/orders-store'
import { refundOrder } from '@/lib/server/refund-order'
import { loadOrderFacts } from '@/lib/server/refunds/order-facts'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { isStripeConfigured } from '@/lib/server/stripe'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { requireStaff } from '@/lib/server/staff'

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
 *   amount?: number   Major units IN CHF (same as order.total). Omit for a
 *                     full refund of whatever remains unrefunded.
 *   expectedRefunded?: number
 *                     CHF already refunded as the console showed it; 409 when
 *                     the order has moved on since (a stale screen).
 *
 * A card payment taken in EUR or USD is refunded in that currency, at the
 * rate it was CHARGED at — recorded on the order — never today's, so a
 * refund always returns exactly its share of what the customer paid.
 *
 * Through the refund ledger (lib/server/refund-order.ts): reserved under the
 * order's lock — never more than was paid, never two at once — and recorded
 * with what Stripe answered.
 *
 * WHO. A named staff member with refund.execute (manager or owner — or the
 * shared login while no staff exist). A refund at or above the policy's
 * second-approval threshold is refused HERE: it must go through a case,
 * where a second person approves it. This screen is not a way around that.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('refund.execute')
  if (!gate.ok) return gate.response
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe не настроен' }, { status: 503 })
  }

  // An empty (or non-object) body means a full refund.
  const body = (await readJsonObject<{ amount?: unknown; expectedRefunded?: unknown }>(request)) ?? {}

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

  // The screen the refund was pressed on must still be true: what it showed
  // as already refunded is what the order records now. A second tab, or a
  // colleague, refunding in between makes it stale — and a refund pressed on
  // a stale screen is how one refund becomes two. (The console sends it;
  // other callers may omit it.)
  if (body.expectedRefunded !== undefined && body.expectedRefunded !== null) {
    const expected = Number(body.expectedRefunded)
    if (!Number.isFinite(expected) || Math.abs(expected - (order.refundedAmount ?? 0)) > 0.004) {
      return NextResponse.json(
        { error: 'По заказу уже был возврат — обновите страницу и проверьте сумму.', refundedAmount: order.refundedAmount ?? 0 },
        { status: 409 },
      )
    }
  }

  // The refund itself — Stripe call, currency rate, cumulative recording — is
  // lib/server/refund-order.ts, shared with approving a return so the two
  // cannot drift. What stays here is this route's own contract: its status
  // codes and its response shape, unchanged.
  // The second-approval threshold counts what the order has already refunded
  // or been promised, so a large refund cannot be taken in small steps here.
  const [policy, facts] = await Promise.all([activePolicy(), loadOrderFacts({ number: order.id })])
  const threshold = policy.config.approvals.secondApprovalMinor
  const asked = amount !== undefined ? toMinor(amount.toFixed(2)) : Math.round((order.total - (order.refundedAmount ?? 0)) * 100)
  if (threshold !== null && threshold !== undefined && asked + (facts?.promisedMinor ?? 0) >= threshold) {
    return NextResponse.json(
      { error: 'Сумма требует согласования второго сотрудника — оформите возврат через заявку (Возвраты → Новая заявка).' },
      { status: 409 },
    )
  }

  const result = await refundOrder(order, amount, {
    source: 'order_screen',
    actor: gate.actor,
    reason: 'Refund from the order screen',
  })
  if (!result.ok) {
    const status =
      result.reason === 'manual' ? 400 : result.reason === 'not_paid' || result.reason === 'in_flight' || result.reason === 'exceeds' ? 409 : result.reason === 'unconfigured' ? 503 : 400
    const error =
      result.reason === 'manual' ? 'Возврат через Stripe недоступен для этого заказа' : result.message
    return NextResponse.json({ error }, { status })
  }

  return NextResponse.json({
    order: result.order,
    refundId: result.refundId,
    status: result.status,
    refunded: result.refunded,
    totalRefunded: result.totalRefunded,
    fullyRefunded: result.fullyRefunded,
  })
}
