import { NextResponse, type NextRequest } from 'next/server'
import {
  parseRating,
  readProductReviews,
  reviewEligibility,
  submitReview,
  type ReviewEligibility,
} from '@/lib/server/product-reviews'
import { enforceLimit } from '@/lib/server/rate-limit'
import { getCurrentUser } from '@/lib/supabase/server'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** The answer depends on who is asking; no cache may keep it. */
const PRIVATE = { 'Cache-Control': 'private, no-store' }

/**
 * Reviews for one product. Verified buyers only (migration 0052,
 * lib/server/product-reviews.ts).
 *
 * GET is public: approved reviews are what the product page shows everyone.
 * It also says where the CURRENT visitor stands, so the page can show the
 * form, a sign-in link or the verified-buyers notice without a second round
 * trip. `eligibility` is 'unknown' when the database could not be asked; the
 * page then offers nothing.
 *
 * POST writes a review, pending moderation:
 *   401 SIGN_IN_REQUIRED    no session
 *   403 NOT_VERIFIED_BUYER  no delivered order of theirs contains the product
 *   409 ALREADY_REVIEWED    one review per customer per product
 *   400                     malformed body, or a rating that is not 1–5
 *   201                     accepted, pending
 */
export async function GET(_request: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params
  const { reviews, stats } = await readProductReviews(params.slug)

  // Asked only for a signed-in visitor; for anyone else the answer is known.
  const user = await getCurrentUser()
  let eligibility: ReviewEligibility | 'unknown' = 'signed_out'
  if (user) eligibility = (await reviewEligibility(params.slug))?.status ?? 'unknown'

  return NextResponse.json({ reviews, stats, eligibility }, { headers: PRIVATE })
}

export async function POST(request: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params
  const limited = await enforceLimit('review.create', request)
  if (limited) return limited

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'SIGN_IN_REQUIRED' }, { status: 401, headers: PRIVATE })

  const body = await readJsonObject<{ rating?: unknown; comment?: unknown }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: PRIVATE })
  }

  // The purchase is looked up in the customer's own order history, server
  // side. Nothing in the request (no order id, no flag) can make someone a
  // buyer; the order to link is the one the database finds.
  const eligibility = await reviewEligibility(params.slug)
  if (!eligibility) {
    return NextResponse.json({ error: 'UNAVAILABLE' }, { status: 503, headers: PRIVATE })
  }
  switch (eligibility.status) {
    case 'signed_out':
      return NextResponse.json({ error: 'SIGN_IN_REQUIRED' }, { status: 401, headers: PRIVATE })
    case 'reviewed':
      return NextResponse.json({ error: 'ALREADY_REVIEWED' }, { status: 409, headers: PRIVATE })
    case 'not_purchased':
      return NextResponse.json({ error: 'NOT_VERIFIED_BUYER' }, { status: 403, headers: PRIVATE })
  }
  if (!eligibility.orderId) {
    return NextResponse.json({ error: 'NOT_VERIFIED_BUYER' }, { status: 403, headers: PRIVATE })
  }

  const rating = parseRating(body.rating)
  if (rating === null) {
    return NextResponse.json({ error: 'INVALID_RATING' }, { status: 400, headers: PRIVATE })
  }
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== 'string') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: PRIVATE })
  }

  const result = await submitReview({
    userId: user.id,
    productId: params.slug,
    orderId: eligibility.orderId,
    rating,
    comment: typeof body.comment === 'string' ? body.comment : undefined,
  })

  if (!result.ok) {
    const status = result.error === 'ALREADY_REVIEWED' ? 409 : result.error === 'NOT_VERIFIED_BUYER' ? 403 : 500
    return NextResponse.json({ error: result.error }, { status, headers: PRIVATE })
  }

  // Pending, not published. The page says so rather than implying the review
  // is live and leaving the customer to wonder why they cannot see it.
  return NextResponse.json({ ok: true, pending: true }, { status: 201, headers: PRIVATE })
}
