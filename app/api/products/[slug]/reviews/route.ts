import { NextResponse, type NextRequest } from 'next/server'
import { canReview, readProductReviews, submitReview } from '@/lib/server/product-reviews'
import { enforceLimit } from '@/lib/server/rate-limit'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Reviews for one product.
 *
 * GET is public — approved reviews are what the product page shows to
 * everyone. It also reports whether the CURRENT visitor may write one, so the
 * page can render the form or not without a second round trip.
 *
 * POST is gated by the RLS policy from migration 0004: only a customer whose
 * order containing this product reached `delivered`. That rule lives in the
 * database, not here.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const { reviews, stats } = await readProductReviews(params.slug)

  // Only asked for a signed-in visitor; for everyone else the answer is
  // always no and the RPC would be a wasted round trip.
  const user = await getCurrentUser()
  const reviewableOrderId = user ? await canReview(params.slug) : null

  return NextResponse.json({
    reviews,
    stats,
    canReview: Boolean(reviewableOrderId),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const limited = await enforceLimit('review.create', request)
  if (limited) return limited

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { rating?: unknown; comment?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // The order is resolved server-side rather than accepted from the request:
  // taking an order id from the client would let someone review a product
  // against an order that is not theirs, and only RLS would catch it.
  const orderId = await canReview(params.slug)
  if (!orderId) {
    return NextResponse.json({ error: 'NOT_ELIGIBLE' }, { status: 403 })
  }

  const result = await submitReview({
    productId: params.slug,
    orderId,
    rating: Number(body.rating),
    comment: typeof body.comment === 'string' ? body.comment : undefined,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === 'ALREADY_REVIEWED' ? 409 : 403 },
    )
  }

  // Pending, not published. The page says so rather than implying the review
  // is live and leaving the customer to wonder why they cannot see it.
  return NextResponse.json({ ok: true, pending: true }, { status: 201 })
}
