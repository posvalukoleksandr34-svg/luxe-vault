// Server-only persistence for site testimonials, backed by Postgres.
//
// Replaces the JSON-file store, which could not work on Vercel (read-only
// filesystem outside /tmp) — the same failure that made the support widget
// report "Failed to send message".
//
// IMPORTANT — two review tables, on purpose:
//
//   public.site_reviews  anonymous testimonials about the store
//                        {name, rating, message}, no account required.
//                        THIS module.
//
//   public.reviews       purchase-verified product reviews
//                        {user_id, product_id, order_id, rating, comment},
//                        insertable only by the buyer of a delivered order.
//
// They are deliberately not merged: relaxing `reviews` to accept anonymous
// rows would destroy the "verified purchase" guarantee that makes those
// reviews worth displaying in the first place.
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Review, ReviewStatus } from '@/lib/types'

const REVIEW_SELECT = 'id, created_at, name, rating, message, status'

function rowToReview(row: Record<string, unknown>): Review {
  return {
    id: row.id as string,
    name: row.name as string,
    rating: row.rating as number,
    message: row.message as string,
    createdAt: new Date(row.created_at as string).getTime(),
    status: row.status as ReviewStatus,
  }
}

/**
 * All testimonials, newest first — including pending ones.
 *
 * Callable only from the server. The public endpoint filters to `approved`
 * before responding; the admin console needs the unmoderated list.
 */
export async function readReviews(): Promise<Review[]> {
  const { data, error } = await createAdminClient()
    .from('site_reviews')
    .select(REVIEW_SELECT)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to read reviews: ${error.message}`)
  return (data ?? []).map(rowToReview)
}

/**
 * Stores a testimonial and returns the row Postgres wrote.
 *
 * `status` is forced to 'pending' rather than taken from the caller: a client
 * that could choose its own status could publish straight to the storefront.
 */
export async function addReview(review: Review, userId?: string): Promise<Review> {
  const { data, error } = await createAdminClient()
    .from('site_reviews')
    .insert({
      name: review.name,
      rating: review.rating,
      message: review.message,
      status: 'pending',
      user_id: userId ?? null,
    })
    .select(REVIEW_SELECT)
    .single()

  if (error) throw new Error(`Failed to save review: ${error.message}`)
  return rowToReview(data)
}

export async function setReviewStatus(
  id: string,
  status: ReviewStatus,
): Promise<Review | null> {
  const { data, error } = await createAdminClient()
    .from('site_reviews')
    .update({ status })
    .eq('id', id)
    .select(REVIEW_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to update review: ${error.message}`)
  return data ? rowToReview(data) : null
}

export async function deleteReview(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('site_reviews')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to delete review: ${error.message}`)
  return Boolean(data)
}
