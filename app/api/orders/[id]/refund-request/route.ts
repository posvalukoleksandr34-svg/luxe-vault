import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById, requestRefund } from '@/lib/server/orders-store'
import { getCurrentUser } from '@/lib/supabase/server'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * Customer-initiated REFUND REQUEST for a paid order.
 *
 * This deliberately does not move money. It flags the order for review, and an
 * admin executes the actual Stripe refund via
 * /api/admin/orders/[id]/refund — the split migration 0004 already established
 * for returns ("Approving and refunding stay with the service_role key").
 *
 * A one-click self-refund would let a customer order, receive the goods, and
 * return the money to themselves before anyone looked at it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('account.write', user.id)
  if (limited) return limited

  // Reason is optional.
  const body = (await readJsonObject<{ reason?: unknown }>(request)) ?? {}
  // Free text from the customer: a string, bounded, or nothing.
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 1000) : undefined

  const order = await getOrderById(params.id)
  // One response for "no such order" and "not yours", so ids cannot be probed.
  if (!order || order.userId !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.paymentStatus !== 'paid') {
    return NextResponse.json(
      { error: 'Only a paid order can be refunded' },
      { status: 409 },
    )
  }
  if (order.returnStatus && order.returnStatus !== 'none') {
    return NextResponse.json({ order, alreadyRequested: true })
  }

  const { order: updated, conflict } = await requestRefund(params.id, reason)
  if (conflict) {
    return NextResponse.json({ error: 'That request has already been sent' }, { status: 409 })
  }

  return NextResponse.json({ order: updated })
}
