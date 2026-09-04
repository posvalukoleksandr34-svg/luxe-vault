import { NextResponse, type NextRequest } from 'next/server'
import { getOrdersByCredentials } from '@/lib/server/orders-store'

export const dynamic = 'force-dynamic'

const MAX_LOOKUPS = 50

/**
 * Returns the orders this browser placed, and only those: each entry must be
 * accompanied by the random lookup token issued when the order was created.
 * Without a real customer session this token — not the guessable order id —
 * is what keeps one shopper from reading another's name, address and phone.
 */
export async function POST(request: NextRequest) {
  let body: { orders?: { id?: unknown; token?: unknown }[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!Array.isArray(body.orders)) {
    return NextResponse.json({ error: 'Malformed lookup' }, { status: 400 })
  }

  const credentials = body.orders
    .slice(0, MAX_LOOKUPS)
    .filter(
      (entry): entry is { id: string; token: string } =>
        typeof entry?.id === 'string' && typeof entry?.token === 'string',
    )
    .map((entry) => ({ id: entry.id, token: entry.token }))

  if (credentials.length === 0) {
    return NextResponse.json({ orders: [] })
  }

  const orders = await getOrdersByCredentials(credentials)
  return NextResponse.json({
    orders: orders.sort((a, b) => b.createdAt - a.createdAt),
  })
}
