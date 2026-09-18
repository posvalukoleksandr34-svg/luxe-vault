import { NextResponse, type NextRequest } from 'next/server'
import { getOrderById } from '@/lib/server/orders-store'
import { enforceLimit } from '@/lib/server/rate-limit'
import { safeEqual } from '@/lib/server/secure-compare'

export const dynamic = 'force-dynamic'

/**
 * Polled by the customer's own checkout view while a crypto payment waits for
 * confirmation. Only exposes the two status fields the UI needs, never the
 * full order record (name/phone/address stay out of this response).
 *
 * Gated on the order's lookup token, like every other per-order payment route.
 * Without it, order numbers (LV- plus six characters) could be walked to learn
 * which orders exist and whether each was paid. The token travels in a header
 * rather than the query string so it never lands in access logs or referrers.
 * "Order not found" covers both a missing order and a wrong token.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceLimit('payment.status', request)
  if (limited) return limited

  const orderId = request.nextUrl.searchParams.get('orderId')
  const token = request.headers.get('x-order-token')
  if (!orderId || !token) {
    return NextResponse.json({ error: 'Missing orderId or token' }, { status: 400 })
  }

  const order = await getOrderById(orderId)
  if (!order || !safeEqual(order.lookupToken, token)) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  return NextResponse.json(
    {
      paymentStatus: order.paymentStatus ?? null,
      orderStatus: order.status,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
