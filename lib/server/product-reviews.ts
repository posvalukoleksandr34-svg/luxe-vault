import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { moderateReview, type ModerationFlag } from '@/lib/server/review-moderation'

/**
 * Product reviews.
 *
 * `public.reviews` has existed since migration 0004; this module is the only
 * code that reads or writes it. (The store's own testimonials are
 * `site_reviews`, a different table and a different thing.)
 *
 * VERIFIED BUYERS ONLY (migration 0052)
 *
 * A review can be written only by a signed-in customer with a DELIVERED order
 * that contains the product, and only once per product. Three layers say so,
 * so that no single edit can quietly drop the rule:
 *
 *   1. The API asks review_eligibility() before writing, and answers 401, 403
 *      or 409 itself.
 *   2. The insert runs as the customer (request-scoped client), so the RLS
 *      policy asks the same question again.
 *   3. A trigger asks it of every writer, service role included, and a unique
 *      index keeps it to one review per customer per product.
 *
 * So every row is a verified purchase by construction, and the badge on the
 * page states a fact about the data rather than making a claim.
 *
 * Then moderation (lib/server/review-moderation.ts): a 4–5 star review the
 * filter finds clean is published at once; anything else stays `pending` for
 * the admin queue (Admin → Отзывы о товарах). The stats view excludes pending
 * rows, so a held review cannot move a product's average until a person has
 * seen it.
 */

export type ProductReview = {
  id: string
  rating: number
  comment?: string
  createdAt: number
  /** Display name, resolved from the profile. Never the email. */
  author: string
  /** True while the review is still linked to its order. Every review is
   *  written against a delivered order (0052); the link is lost only if that
   *  order is later purged, and the badge then goes with it. */
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
 * Where the signed-in customer stands with this product:
 *
 *   signed_out     no session reached the database
 *   not_purchased  no delivered order of theirs contains it (including an
 *                  order that is paid but still on its way)
 *   reviewed       they have already reviewed it, in any state
 *   eligible       they may, against `orderId`, their latest delivered order
 *                  containing it
 *
 * The answer comes from the database (review_eligibility, migration 0052),
 * reading the customer's own order history; nothing in the request decides
 * it. Null when the question could not be asked (database unreachable, 0052
 * not applied): callers treat that as "no".
 */
export const REVIEW_ELIGIBILITY = ['signed_out', 'not_purchased', 'reviewed', 'eligible'] as const
export type ReviewEligibility = (typeof REVIEW_ELIGIBILITY)[number]

export async function reviewEligibility(
  productId: string,
): Promise<{ status: ReviewEligibility; orderId: string | null } | null> {
  const { data, error } = await createClient().rpc('review_eligibility', {
    p_product_id: productId,
  })

  if (error) {
    console.error('[reviews] eligibility check failed:', error.message)
    return null
  }

  const row = Array.isArray(data) ? data[0] : data
  const status = row?.status as ReviewEligibility | undefined
  if (!status || !REVIEW_ELIGIBILITY.includes(status)) return null
  if (status === 'eligible') {
    return row.order_id ? { status, orderId: row.order_id as string } : null
  }
  return { status, orderId: null }
}

/** A star rating from a request body: a whole number from 1 to 5, or null. */
export function parseRating(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

export type SubmitReviewError = 'ALREADY_REVIEWED' | 'NOT_VERIFIED_BUYER' | 'SAVE_FAILED'

/**
 * Submits a review as the signed-in customer.
 *
 * Deliberately uses the REQUEST-SCOPED client, so the RLS policy and the
 * trigger from 0052 admit or refuse the row even if the caller's own check
 * were wrong. Writing this with the service role would leave the "did they
 * actually buy it" rule to application code alone.
 *
 * `status` is not sent: customers cannot write that column, and the
 * database's default is 'pending'.
 */
export async function submitReview(input: {
  userId: string
  productId: string
  orderId: string
  rating: number
  comment?: string
}): Promise<{ ok: true } | { ok: false; error: SubmitReviewError }> {
  const comment = input.comment?.trim().slice(0, 4000) || null

  const { error } = await createClient().from('reviews').insert({
    user_id: input.userId,
    product_id: input.productId,
    order_id: input.orderId,
    rating: input.rating,
    comment,
  })

  if (error) {
    // 23505: the one-review-per-customer-per-product index. Reached when two
    // submissions race past the eligibility check together.
    if (error.code === '23505') return { ok: false, error: 'ALREADY_REVIEWED' }
    // 42501: the insert policy or the purchase trigger refused the row.
    if (error.code === '42501') return { ok: false, error: 'NOT_VERIFIED_BUYER' }
    console.error('[reviews] insert failed:', error.code, error.message)
    return { ok: false, error: 'SAVE_FAILED' }
  }

  return { ok: true }
}

/**
 * Publishes a review the automatic filter passed (lib/server/review-moderation.ts).
 *
 * Service role, because customers cannot write `status` (0052). Matched on
 * the customer and product (one review each, 0052) and only while still
 * pending, so it can never re-publish something an admin rejected.
 */
export async function autoApproveReview(userId: string, productId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('reviews')
    .update({ status: 'approved' })
    .eq('user_id', userId)
    .eq('product_id', productId)
    .eq('status', 'pending')
    .select('id')
  if (error) {
    console.error('[reviews] auto-approve failed:', error.message)
    return false
  }
  return (data ?? []).length > 0
}

// ------------------------------------------------------------------ admin ----

export type PendingProductReview = {
  id: string
  productId: string
  productName: string
  rating: number
  comment?: string
  createdAt: number
  /** Full name and email: the admin sees who wrote it, the storefront never does. */
  authorName: string
  authorEmail: string
  orderNumber?: string
  /** Why the automatic filter held it. */
  flags: ModerationFlag[]
}

/**
 * The quarantine: product reviews still waiting for a person, oldest first,
 * each with the reasons the filter held it. Admin only (the routes call
 * requireAdmin); service role.
 */
export async function readPendingProductReviews(limit = 200): Promise<PendingProductReview[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('reviews')
    .select('id, product_id, rating, comment, created_at, user_id, order_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  if (rows.length === 0) return []

  const ids = <T,>(xs: T[]) => Array.from(new Set(xs.filter(Boolean)))
  const [profiles, products, orders] = await Promise.all([
    admin.from('profiles').select('id, name, email').in('id', ids(rows.map((r) => r.user_id as string))),
    admin.from('products').select('slug, name').in('slug', ids(rows.map((r) => r.product_id as string))),
    admin.from('orders').select('id, order_number').in('id', ids(rows.map((r) => r.order_id as string))),
  ])
  const who = new Map((profiles.data ?? []).map((p) => [p.id as string, p]))
  const what = new Map((products.data ?? []).map((p) => [p.slug as string, p]))
  const orderNo = new Map((orders.data ?? []).map((o) => [o.id as string, o.order_number as string]))

  return rows.map((r) => {
    const profile = who.get(r.user_id as string)
    const product = what.get(r.product_id as string)
    const name = product?.name as Record<string, string> | string | undefined
    const comment = (r.comment as string | null) ?? undefined
    return {
      id: r.id as string,
      productId: r.product_id as string,
      productName: (typeof name === 'string' ? name : name?.ru || name?.it || name?.en) || (r.product_id as string),
      rating: Number(r.rating),
      comment,
      createdAt: new Date(r.created_at as string).getTime(),
      authorName: (profile?.name as string) || '—',
      authorEmail: (profile?.email as string) || '',
      orderNumber: orderNo.get(r.order_id as string),
      flags: moderateReview({ rating: Number(r.rating), comment }).flags,
    }
  })
}

/** Approve (publish) or reject (keep hidden; the customer cannot post again). */
export async function setProductReviewStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
  const { data, error } = await createAdminClient().from('reviews').update({ status }).eq('id', id).select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

/** Delete outright; the customer may then write a new review. */
export async function deleteProductReview(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from('reviews').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}
