import { NextResponse, type NextRequest } from 'next/server'

import { parseRating } from '@/lib/server/product-reviews'
import { readJsonObjectLimited } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'
import { submitViaLink } from '@/lib/server/review-requests/links'

export const dynamic = 'force-dynamic'

const STATUS = { NOT_FOUND: 404, EXPIRED: 410, NOT_IN_ORDER: 403, ALREADY_REVIEWED: 409, SAVE_FAILED: 500 } as const

/**
 * POST { token, productId, rating, comment? } — a review written from the
 * link in a review-request email (lib/server/review-requests/links.ts). The
 * token decides whose review it is and for which order; the body only says
 * which of that order's products and what the customer thinks.
 */
export async function POST(request: NextRequest) {
  const limited = (await enforceLimit('review.link', request)) ?? (await enforceLimit('review.create', request))
  if (limited) return limited
  const body = await readJsonObjectLimited<{ token?: unknown; productId?: unknown; rating?: unknown; comment?: unknown }>(request, 16 * 1024)
  if (body === 'too_large') return NextResponse.json({ error: 'TOO_LARGE' }, { status: 413 })
  if (!body || typeof body.token !== 'string' || typeof body.productId !== 'string' || body.productId.length > 200) {
    return NextResponse.json({ error: 'INVALID' }, { status: 400 })
  }
  const rating = parseRating(body.rating)
  if (rating === null) return NextResponse.json({ error: 'INVALID_RATING' }, { status: 400 })
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== 'string') {
    return NextResponse.json({ error: 'INVALID' }, { status: 400 })
  }
  try {
    const result = await submitViaLink({
      token: body.token,
      productId: body.productId,
      rating,
      comment: typeof body.comment === 'string' ? body.comment : undefined,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] })
    return NextResponse.json({ ok: true, pending: !result.published }, { status: 201 })
  } catch (e) {
    console.error('[review-requests] submit failed:', (e as Error).message)
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 })
  }
}
