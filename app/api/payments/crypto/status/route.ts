import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById } from '@/lib/server/orders-store'

export const dynamic = 'force-dynamic'

// Public — polled by the customer's own checkout view while waiting for
// confirmation. Only exposes the two status fields the UI needs, never the
// full order record (name/phone/address stay out of this response).
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('orderId')
  if (!orderId) {
    return NextResponse.json({ error: 'Missing orderId' }, { status: 400 })
  }

  const order = await getOrderById(orderId)
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  return NextResponse.json({
    paymentStatus: order.paymentStatus ?? null,
    orderStatus: order.status,
  })
}
