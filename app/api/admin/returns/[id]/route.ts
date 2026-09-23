import { NextResponse, type NextRequest } from 'next/server'

import { reportServerError } from '@/lib/monitoring/alert'
import { decideReturnRequestSchema, firstIssue } from '@/lib/returns/schema'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { notifyReturnDecision } from '@/lib/server/notifications'
import { getOrderById, recordRefund } from '@/lib/server/orders-store'
import { refundOrder } from '@/lib/server/refund-order'
import { getReturnRequest, moveReturnRequest, setOrderReturnStatus } from '@/lib/server/returns-store'

export const dynamic = 'force-dynamic'

/**
 * A manager's decision on a return request: approve, reject, or — for money
 * returned by hand — mark it done.
 *
 * Gated twice, like every /api/admin route: middleware.ts, and requireAdmin()
 * here, because a matcher is a pattern and a pattern can be edited.
 *
 * THE ORDER OF WRITES IS THE DESIGN. Approving is three steps that can each
 * fail — claim the request, move the money, close the request — and they run
 * in the order that leaves every failure recoverable:
 *
 *   1. CLAIM: pending → approved, compare-and-set. Two managers pressing
 *      Approve at once, or one double-clicking, get one winner; the other is
 *      told it was already decided rather than both proceeding.
 *   2. REFUND through Stripe (lib/server/refund-order.ts).
 *   3. CLOSE: approved → completed, and only now does the customer hear.
 *
 * If step 2 fails the request is left APPROVED — decided, money not yet moved
 * — and pressing Approve again retries only the refund. That is why approved
 * and completed are separate states at all: collapsing them would leave a
 * request marked done with nobody's money returned.
 *
 * WHY NO STRIPE IDEMPOTENCY KEY, which looks like the obvious guard: Stripe
 * caches an idempotent request's result for 24 hours INCLUDING a 500. Keyed on
 * the request, one transient Stripe outage would make every retry of that
 * approval fail for a day. The money is protected without it — refundPayment
 * reads the remaining balance from the charge, and Stripe itself refuses a
 * refund larger than the charge's remainder at creation — so a concurrent
 * double refund is impossible, and a retry still works.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}
  // The id is the ROUTE's: a decision is about the request in the address,
  // whatever the body says.
  const parsed = decideReturnRequestSchema.safeParse({ ...body, id: params.id })
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  }
  const decision = parsed.data

  const existing = await getReturnRequest(params.id)
  if (!existing) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })

  const order = await getOrderById(existing.orderNumber)
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  // ---------------------------------------------------------------- reject --
  if (decision.decision === 'reject') {
    const moved = await moveReturnRequest(params.id, 'pending', 'rejected', decision.adminNotes)
    if (!moved) {
      return NextResponse.json({ error: 'Заявка уже рассмотрена' }, { status: 409 })
    }
    await setOrderReturnStatus(order.id, 'rejected')
    // The reason goes to the customer verbatim. A rejection they are not told
    // the reason for is the one they take to their bank.
    if (order.userId) {
      void notifyReturnDecision({
        userId: order.userId,
        orderId: order.id,
        outcome: 'rejected',
        note: decision.adminNotes,
      })
    }
    return NextResponse.json({ ok: true, request: moved })
  }

  // -------------------------------------------------------------- complete --
  // Money returned by hand, outside any API. Only for a request already
  // approved, and only for a payment Stripe could not have refunded — a card
  // payment is refunded by approving, and marking it done by hand would close
  // a request whose money never moved.
  if (decision.decision === 'complete') {
    if (order.paymentProvider === 'stripe') {
      return NextResponse.json(
        { error: 'Оплата картой возвращается кнопкой «Одобрить и вернуть»' },
        { status: 409 },
      )
    }
    const moved = await moveReturnRequest(params.id, 'approved', 'completed', decision.adminNotes)
    if (!moved) {
      return NextResponse.json({ error: 'Заявка не в статусе «Одобрена»' }, { status: 409 })
    }
    // A full refund: restores stock, reverses a referral reward and emails
    // the customer — exactly as a Stripe refund would. No Stripe id, because
    // there is none; see recordRefund.
    await recordRefund(order.id, { refundedAmount: order.total, fully: true })
    await setOrderReturnStatus(order.id, 'refunded')
    if (order.userId) {
      void notifyReturnDecision({ userId: order.userId, orderId: order.id, outcome: 'refunded' })
    }
    return NextResponse.json({ ok: true, request: moved })
  }

  // --------------------------------------------------------------- approve --
  // Step 1 — claim. From `approved` as well as `pending`, so a refund that
  // failed last time can be retried without the request being re-opened.
  const claimed = await moveReturnRequest(
    params.id,
    ['pending', 'approved'],
    'approved',
    decision.adminNotes,
  )
  if (!claimed) {
    return NextResponse.json({ error: 'Заявка уже рассмотрена' }, { status: 409 })
  }
  await setOrderReturnStatus(order.id, 'approved')

  // Step 2 — the money.
  const refund = await refundOrder(order, decision.amount)

  if (!refund.ok) {
    if (refund.reason === 'manual') {
      // Not a failure: a crypto payment has no refund API. Left approved,
      // with the manager told to return it by hand and then mark it done.
      return NextResponse.json({ ok: true, manual: true, message: refund.message, request: claimed })
    }
    // Left APPROVED — decided, money not moved. Pressing Approve again retries
    // just this step. Reported, because a refund that keeps failing is a
    // customer waiting on money with nobody watching.
    void reportServerError(
      'Returns · approved but the refund failed',
      new Error(`${existing.orderNumber}: ${refund.message}`),
    )
    return NextResponse.json(
      { error: `Одобрено, но возврат не прошёл: ${refund.message}. Повторите.`, retryable: true },
      { status: 502 },
    )
  }

  // Step 3 — close, and only now tell the customer.
  const closed = await moveReturnRequest(params.id, 'approved', 'completed')
  await setOrderReturnStatus(order.id, 'refunded')
  if (order.userId) {
    void notifyReturnDecision({ userId: order.userId, orderId: order.id, outcome: 'refunded' })
  }

  return NextResponse.json({
    ok: true,
    request: closed ?? claimed,
    refunded: refund.refunded,
    fullyRefunded: refund.fullyRefunded,
  })
}
