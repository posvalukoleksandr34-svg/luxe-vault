import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById, requestRefund } from '@/lib/server/orders-store'
import { getCurrentUser } from '@/lib/supabase/server'

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

  let body: { reason?: string } = {}
  try {
    body = await request.json()
  } catch {
    // Reason is optional.
  }

  const order = await getOrderById(params.id)
  // One response for "no such order" and "not yours", so ids cannot be probed.
  if (!order || order.userId !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.paymentStatus !== 'paid') {
    return NextResponse.json(
      { error: 'Возврат возможен только для оплаченного заказа' },
      { status: 409 },
    )
  }
  if (order.returnStatus && order.returnStatus !== 'none') {
    return NextResponse.json({ order, alreadyRequested: true })
  }

  const { order: updated, conflict } = await requestRefund(params.id, body.reason)
  if (conflict) {
    return NextResponse.json({ error: 'Запрос уже отправлен' }, { status: 409 })
  }

  return NextResponse.json({ order: updated })
}
