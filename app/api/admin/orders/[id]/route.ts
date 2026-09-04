import { NextResponse, type NextRequest } from 'next/server'
import { deleteOrder, setOrderStatus } from '@/lib/server/orders-store'
import type { OrderStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: OrderStatus[] = ['В обработке', 'Отправлен', 'Доставлен', 'Отменён']

// Auth is already enforced by middleware.ts for every /api/admin/* path.

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.status || !VALID_STATUSES.includes(body.status as OrderStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updated = await setOrderStatus(params.id, body.status as OrderStatus)
  if (!updated) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
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
