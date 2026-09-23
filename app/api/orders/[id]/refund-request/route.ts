import { NextResponse, type NextRequest } from 'next/server'
import { createReturnRequestSchema, firstIssue } from '@/lib/returns/schema'
import { getOrderById } from '@/lib/server/orders-store'
import { createReturnRequest } from '@/lib/server/returns-store'
import { getCurrentUser } from '@/lib/supabase/server'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { readJsonObject } from '@/lib/server/http'
import { notifyReturnRequested } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * Customer-initiated RETURN REQUEST for a paid order.
 *
 * IT DOES NOT MOVE MONEY, and never has. It files a request for a human to
 * review, and an admin executes the actual Stripe refund through
 * /api/admin/orders/[id]/refund — the split migration 0004 established and
 * migration 0039 gave a table to. A one-click self-refund would let a customer
 * order, receive the goods, and return the money to themselves before anyone
 * looked at it.
 *
 * What changed here is what gets RECORDED. It used to set orders.return_status
 * to 'requested' with an optional line of free text, which told a manager that
 * somebody wanted something back and nothing else. It now writes a
 * return_requests row — the reason, the customer's own words, and their
 * confirmation that the piece is unworn — which is what a manager actually
 * needs in order to approve or refuse, and what the /admin queue reads.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('account.write', user.id)
  if (limited) return limited

  const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}

  // The order number comes from the ROUTE, never the body: a customer could
  // otherwise file a return against an order that is not theirs by sending a
  // different one. The path is what ownership is then checked against below.
  const parsed = createReturnRequestSchema.safeParse({ ...body, orderNumber: params.id })
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  }

  const order = await getOrderById(params.id)
  // One response for "no such order" and "not yours", so ids cannot be probed.
  if (!order || order.userId !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.paymentStatus !== 'paid') {
    return NextResponse.json(
      { error: 'Only a paid order can be returned' },
      { status: 409 },
    )
  }

  const result = await createReturnRequest({
    orderNumber: order.id,
    userId: user.id,
    reason: parsed.data.reason,
    comment: parsed.data.comment,
    images: parsed.data.images,
  })

  if (!result.ok) {
    if (result.reason === 'already_open') {
      // Not an error the customer caused twice over: tell them the state they
      // are already in, and let the page show the pending badge.
      return NextResponse.json({ error: 'ALREADY_OPEN', alreadyRequested: true }, { status: 409 })
    }
    if (result.reason === 'unavailable') {
      return NextResponse.json({ error: 'Returns are temporarily unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // The manager needs to know a request is waiting; without this the queue is
  // only discovered by someone opening the admin panel. Never blocks the
  // customer's response — the request is filed either way.
  void notifyReturnRequested(order, parsed.data.reason, parsed.data.comment)

  return NextResponse.json({ ok: true, request: result.request })
}
