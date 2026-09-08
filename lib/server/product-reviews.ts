import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Product reviews.
 *
 * `public.reviews` has existed since migration 0004 and nothing has ever read
 * or written it — the storefront's only reviews were site testimonials, which
 * are a different table and a different thing. This module is the first code
 * to use it.
 *
 * WHAT MAKES A REVIEW TRUSTWORTHY HERE
 *
 * The RLS policy from 0004 only admits a review from a customer whose order
 * containing that product reached `delivered`, and a unique index keeps it to
 * one review per product per order. So every row is a verified purchase by
 * construction — the badge is a fact about the data, not a claim.
 *
 * Reviews are still moderated: they arrive `pending` and only an admin can
 * approve them. The stats view excludes pending rows, so an unreviewed
 * submission cannot move a product's average before a human has seen it.
 */

export type ProductReview = {
  id: string
  rating: number
  comment?: string
  createdAt: number
  /** Display name, resolved from the profile. Never the email. */
  author: string
  /** Always true today — the RLS policy admits nothing else — but carried
   *  explicitly so the badge does not become a lie if the rule ever loosens. */
  verified: boolean
}

export type ReviewStats = {
  total: number
  average: number
  /** Counts per star, 5 down to 1. */
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>
}

const EMPTY_STATS: ReviewStats = {
  total: 0,
  average: 0,
  breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
}

/**
 * Approved reviews for one product, plus the summary.
 *
 * Uses the service-role client for one specific reason: the reviewer's name
 * lives in `profiles`, which is RLS-scoped to its owner, so a customer's own
 * session cannot read another customer's display name. Only the name is taken
 * from that row — never the email, never anything else.
 */
export async function readProductReviews(
  productId: string,
  limit = 20,
): Promise<{ reviews: ProductReview[]; stats: ReviewStats }> {
  const admin = createAdminClient()

  const [reviewsRes, statsRes] = await Promise.all([
    admin
      .from('reviews')
      .select('id, rating, comment, created_at, order_id, user_id')
      .eq('product_id', productId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('product_review_stats')
      .select('total, average, five, four, three, two, one')
      .eq('product_id', productId)
      .maybeSingle(),
  ])

  if (reviewsRes.error) {
    // Missing table or view means 0018 has not been applied. An unreviewed
    // product page is a fine degradation; a 500 is not.
    console.error('[reviews] read failed:', reviewsRes.error.message)
    return { reviews: [], stats: EMPTY_STATS }
  }

  const rows = reviewsRes.data ?? []

  // One lookup for every author rather than a join, because PostgREST cannot
  // embed auth-owned profiles here and N queries for N reviews is worse.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id as string)))
  const names = new Map<string, string>()

  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, name')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      names.set(p.id as string, (p.name as string) ?? '')
    }
  }

  const s = statsRes.data
  const stats: ReviewStats = s
    ? {
        total: Number(s.total) || 0,
        average: Number(s.average) || 0,
        breakdown: {
          5: Number(s.five) || 0,
          4: Number(s.four) || 0,
          3: Number(s.three) || 0,
          2: Number(s.two) || 0,
          1: Number(s.one) || 0,
        },
      }
    : EMPTY_STATS

  return {
    reviews: rows.map((r) => ({
      id: r.id as string,
      rating: Number(r.rating),
      comment: (r.comment as string | null) ?? undefined,
      createdAt: new Date(r.created_at as string).getTime(),
      // First name only. A full name on a public page is more than a customer
      // agreed to when they bought a coat.
      author: (names.get(r.user_id as string) || '').split(' ')[0] || 'Customer',
      verified: Boolean(r.order_id),
    })),
    stats,
  }
}

/**
 * The delivered order this customer may review the product against, if any.
 *
 * Asked before rendering the form: offering a review box to someone the
 * database will refuse is worse than not offering one.
 */
export async function canReview(productId: string): Promise<string | null> {
  const { data, error } = await createClient().rpc('can_review', {
    p_product_id: productId,
  })

  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  return row?.allowed ? (row.order_id as string) : null
}

/**
 * Submits a review as the signed-in customer.
 *
 * Deliberately uses the REQUEST-SCOPED client, so the RLS policy from 0004 is
 * what admits or refuses the row. Writing this with the service role would
 * move the "did they actually buy it" rule into application code, where a
 * future edit could drop it silently.
 */
export async function submitReview(input: {
  productId: string
  orderId: string
  rating: number
  comment?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const rating = Math.round(input.rating)
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Rating must be between 1 and 5' }
  }

  const comment = input.comment?.trim().slice(0, 4000) || null

  const { error } = await createClient().from('reviews').insert({
    product_id: input.productId,
    order_id: input.orderId,
    rating,
    comment,
    // Never trusted from the client: a review is published only after a human
    // approves it.
    status: 'pending',
  })

  if (error) {
    // 23505 is the one-review-per-order unique index doing its job.
    if (error.code === '23505') {
      return { ok: false, error: 'ALREADY_REVIEWED' }
    }
    console.error('[reviews] insert failed:', error.message)
    return { ok: false, error: 'NOT_ELIGIBLE' }
  }

  return { ok: true }
}
