import { NextResponse, type NextRequest } from 'next/server'
import { deleteOrder, setOrderStatus } from '@/lib/server/orders-store'
import { notifyStatusUpdate } from '@/lib/server/notifications'
import { ORDER_STATUSES, type OrderStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: OrderStatus[] = ORDER_STATUSES

// Auth is already enforced by middleware.ts for every /api/admin/* path.

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: { status?: string; trackingNumber?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.status || !VALID_STATUSES.includes(body.status as OrderStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // `undefined` leaves the stored tracking number untouched; an explicit empty
  // string clears it. Anything non-string is rejected rather than coerced.
  let trackingNumber: string | null | undefined
  if (body.trackingNumber !== undefined) {
    if (typeof body.trackingNumber !== 'string') {
      return NextResponse.json({ error: 'Invalid tracking number' }, { status: 400 })
    }
    const trimmed = body.trackingNumber.trim()
    if (trimmed.length > 0 && (trimmed.length < 4 || trimmed.length > 64)) {
      // Mirrors the CHECK constraint on orders.tracking_number, so a bad value
      // is a clean 400 instead of a database error surfacing as a 500.
      return NextResponse.json(
        { error: 'Tracking number must be 4-64 characters' },
        { status: 400 },
      )
    }
    trackingNumber = trimmed.length > 0 ? trimmed : null
  }

  const updated = await setOrderStatus(
    params.id,
    body.status as OrderStatus,
    trackingNumber,
  )
  if (!updated) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Tell the customer their order moved. Only for account-bound orders — a
  // guest order has no user_id and therefore no feed to deliver into.
  //
  // Fires after the status is committed, and its failure is swallowed inside
  // notifyStatusUpdate: the admin's action succeeded, and reporting an error
  // here would make staff retry a status change that already applied.
  if (updated.userId) {
    await notifyStatusUpdate({
      userId: updated.userId,
      orderId: updated.id,
      status: updated.status,
      trackingNumber: updated.trackingNumber,
    })
  }

  return NextResponse.json({ order: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const removed = await deleteOrder(params.id)
  if (!removed) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
