import { NextResponse, type NextRequest } from 'next/server'
import { getOrdersByCredentials, getOrdersByUserId } from '@/lib/server/orders-store'
import { getCurrentUser } from '@/lib/supabase/server'
import type { Order } from '@/lib/types'

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

  // Two independent sources, unioned:
  //   * everything this browser holds a valid token for (guest orders), and
  //   * everything bound to the signed-in account.
  // A customer who ordered as a guest and registered afterwards therefore
  // still sees the earlier order, and an account's history follows them to a
  // new device where no tokens exist.
  let sessionOrders: Order[] = []
  try {
    const user = await getCurrentUser()
    if (user) sessionOrders = await getOrdersByUserId(user.id)
  } catch {
    // Not signed in, or Supabase unreachable — token-based results still work.
  }

  const tokenOrders =
    credentials.length > 0 ? await getOrdersByCredentials(credentials) : []

  const byId = new Map<string, Order>()
  for (const order of [...sessionOrders, ...tokenOrders]) byId.set(order.id, order)

  // Array.from rather than spreading the iterator: this project's tsconfig
  // targets ES5, where spreading a Map iterator needs --downlevelIteration.
  return NextResponse.json({
    orders: Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt),
  })
}
