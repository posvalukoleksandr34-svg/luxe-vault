import 'server-only'

import { autoApproveReview } from '@/lib/server/product-reviews'
import { moderateReview } from '@/lib/server/review-moderation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTokenShape, tokenHash } from './tokens'

/**
 * What the link in a review request email may do — and nothing else.
 *
 * The token identifies ONE request, and through it one order of one account.
 * It lets its holder see the names of that order's products, review those
 * products as that account, and opt out of review requests. It does not sign
 * anyone in, reveal the address, the amounts, the account's other orders or
 * anything about another customer. A token that does not hash to a sent
 * request is "not found", the same answer as a malformed one.
 *
 * Reviews go through the same rules as the product page:
 *  - the 0052 trigger checks, for every writer, that the order is the
 *    account's own, delivered, and contains the product;
 *  - one review per account and product (unique index);
 *  - written 'pending', published only when the automatic filter passes it
 *    (lib/server/review-moderation.ts) — otherwise it waits for a person.
 */

const UNSUBSCRIBE_GRACE_MS = 365 * 24 * 60 * 60 * 1000

type RequestRow = {
  id: string
  order_id: string
  user_id: string | null
  status: string
  token_expires_at: string | null
  sent_at: string | null
  first_review_at: string | null
}

export type LinkView =
  | { state: 'not_found' }
  | { state: 'expired' }
  | {
      state: 'ok'
      orderNumber: string
      products: { productId: string; name: string; image: string | null; reviewed: boolean }[]
    }

async function findRequest(token: unknown): Promise<RequestRow | null> {
  if (!isTokenShape(token)) return null
  const { data, error } = await createAdminClient()
    .from('review_requests')
    .select('id, order_id, user_id, status, token_expires_at, sent_at, first_review_at')
    .eq('token_hash', tokenHash(token))
    .maybeSingle()
  if (error) throw new Error(`review link lookup failed: ${error.message}`)
  return (data as RequestRow | null) ?? null
}

function expired(r: RequestRow, now = Date.now()): boolean {
  return !r.token_expires_at || Date.parse(r.token_expires_at) < now
}

export async function viewLink(token: unknown): Promise<LinkView> {
  const r = await findRequest(token)
  // Only a request that was actually emailed has a working link.
  if (!r || r.status !== 'sent' || !r.user_id) return { state: 'not_found' }
  if (expired(r)) return { state: 'expired' }

  const admin = createAdminClient()
  const { data: order, error } = await admin
    .from('orders')
    .select('order_number, user_id, status, order_items(product_id, name, image)')
    .eq('id', r.order_id)
    .maybeSingle()
  if (error) throw new Error(`order read failed: ${error.message}`)
  const o = order as { order_number: string; user_id: string | null; status: string; order_items: { product_id: string; name: string; image: string | null }[] } | null
  // The order must still be this account's delivered order.
  if (!o || o.user_id !== r.user_id || o.status !== 'delivered') return { state: 'not_found' }

  const ids = Array.from(new Set(o.order_items.map((i) => i.product_id)))
  const { data: reviews, error: rError } = await admin.from('reviews').select('product_id').eq('user_id', r.user_id).in('product_id', ids)
  if (rError) throw new Error(`reviews read failed: ${rError.message}`)
  const reviewed = new Set(((reviews ?? []) as { product_id: string }[]).map((x) => x.product_id))
  const seen = new Set<string>()
  const products = o.order_items
    .filter((i) => (seen.has(i.product_id) ? false : (seen.add(i.product_id), true)))
    .map((i) => ({ productId: i.product_id, name: i.name, image: i.image, reviewed: reviewed.has(i.product_id) }))
  return { state: 'ok', orderNumber: o.order_number, products }
}

export type SubmitResult =
  | { ok: true; published: boolean }
  | { ok: false; error: 'NOT_FOUND' | 'EXPIRED' | 'NOT_IN_ORDER' | 'ALREADY_REVIEWED' | 'SAVE_FAILED' }

export async function submitViaLink(input: { token: unknown; productId: string; rating: number; comment?: string }): Promise<SubmitResult> {
  const r = await findRequest(input.token)
  if (!r || r.status !== 'sent' || !r.user_id) return { ok: false, error: 'NOT_FOUND' }
  if (expired(r)) return { ok: false, error: 'EXPIRED' }

  const admin = createAdminClient()
  // The product must be in THIS order. The trigger checks it again in the
  // database; this answer is just clearer than a refused insert.
  const { data: item, error: itemError } = await admin
    .from('order_items')
    .select('product_id')
    .eq('order_id', r.order_id)
    .eq('product_id', input.productId)
    .limit(1)
  if (itemError) throw new Error(`order item read failed: ${itemError.message}`)
  if (!item?.length) return { ok: false, error: 'NOT_IN_ORDER' }

  const comment = input.comment?.trim().slice(0, 4000) || null
  // Service role, because the holder of the link is not signed in. Status is
  // not sent (the column default is 'pending'); user and order come from the
  // request, never from the browser; the 0052 trigger checks the purchase.
  const { error } = await admin.from('reviews').insert({
    user_id: r.user_id,
    product_id: input.productId,
    order_id: r.order_id,
    rating: input.rating,
    comment,
  })
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'ALREADY_REVIEWED' }
    if (error.code === '42501') return { ok: false, error: 'NOT_IN_ORDER' }
    console.error('[review-requests] review insert failed:', error.code, error.message)
    return { ok: false, error: 'SAVE_FAILED' }
  }

  const moderation = moderateReview({ rating: input.rating, comment: comment ?? '' })
  const published = moderation.decision === 'approve' && (await autoApproveReview(r.user_id, input.productId))
  if (!published) console.info(`[review-requests] review held for moderation: ${input.productId} (${moderation.flags.join(', ') || 'auto-approve failed'})`)

  // Conversion, for the admin: first review time and a count.
  const { data: current } = await admin.from('review_requests').select('reviews_submitted, first_review_at').eq('id', r.id).maybeSingle()
  const c = current as { reviews_submitted: number; first_review_at: string | null } | null
  await admin
    .from('review_requests')
    .update({ reviews_submitted: (c?.reviews_submitted ?? 0) + 1, first_review_at: c?.first_review_at ?? new Date().toISOString() })
    .eq('id', r.id)

  return { ok: true, published }
}

/**
 * Opts the order's address out of review requests. Works for a year after
 * the email, even once the review link itself has expired — an unsubscribe
 * link must keep working.
 */
export async function unsubscribeViaLink(token: unknown): Promise<'done' | 'not_found'> {
  const r = await findRequest(token)
  if (!r || !r.sent_at) return 'not_found'
  if (Date.now() - Date.parse(r.sent_at) > UNSUBSCRIBE_GRACE_MS) return 'not_found'
  const admin = createAdminClient()
  const { data: order, error } = await admin.from('orders').select('customer_email').eq('id', r.order_id).maybeSingle()
  if (error) throw new Error(`order read failed: ${error.message}`)
  const email = (order as { customer_email: string | null } | null)?.customer_email?.trim().toLowerCase()
  if (!email) return 'done'
  const { error: upError } = await admin
    .from('email_suppressions')
    .upsert({ email, kind: 'review_requests', reason: 'unsubscribed' }, { onConflict: 'email,kind', ignoreDuplicates: true })
  if (upError) throw new Error(`unsubscribe failed: ${upError.message}`)
  // Anything still waiting for this address is not sent (the worker would
  // see the suppression too; this makes the admin list say so at once).
  // Case-insensitive, with LIKE's own wildcards escaped: "a_b@x" must not match "axb@x".
  const pattern = email.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  const { data: pending } = await admin.from('orders').select('id').ilike('customer_email', pattern)
  const ids = ((pending ?? []) as { id: string }[]).map((p) => p.id)
  if (ids.length) {
    await admin.from('review_requests').update({ status: 'suppressed', reason: 'unsubscribed' }).in('order_id', ids).eq('status', 'scheduled')
  }
  return 'done'
}
