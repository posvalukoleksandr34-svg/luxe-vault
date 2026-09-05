import { NextResponse, type NextRequest } from 'next/server'
import { addOrder } from '@/lib/server/orders-store'
import { buildOrder, validateOrderDraft, type OrderDraftBody } from '@/lib/server/order-drafts'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Public endpoint used by checkout to place an order. The server — not the
 * browser — mints the id, the lookup token and the payment status, and
 * re-runs every checkout validation rule before writing anything.
 *
 * Orders that still need paying are stored as `pending_payment` rather than
 * being thrown away, so the customer can pay them later from their account.
 */
export async function POST(request: NextRequest) {
  let body: OrderDraftBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const result = validateOrderDraft(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Bind the order to the buyer when there is a session. Read from the
  // verified cookie via getUser(), never from a user id in the request body —
  // a client-supplied id would let anyone file orders against another account.
  // Null is expected and fine: guest checkout stays supported, and those
  // orders remain reachable through their lookup token.
  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    // Supabase unreachable or unconfigured — fall back to a guest order rather
    // than failing a checkout the customer has already paid attention to.
  }

  const order = buildOrder(result.draft, userId)
  await addOrder(order)

  return NextResponse.json({ order }, { status: 201 })
}
