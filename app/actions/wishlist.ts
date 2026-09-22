'use server'

import { z } from 'zod'

import { createClient, getCurrentUser } from '@/lib/supabase/server'

/**
 * The saved-products list, server side.
 *
 * THE USER'S OWN CLIENT, NOT THE SERVICE ROLE. Migration 0021 scopes every
 * policy on wishlist_items to `auth.uid()`, so the database itself refuses to
 * hand one customer another's list or write into it. Using the admin key here
 * would bypass exactly the check that makes these actions safe, and would put
 * the burden of getting ownership right back on this file — where a single
 * forgotten `.eq('user_id', …)` is a data leak. Every statement below is
 * therefore scoped by RLS, and the `user_id` we write is the session's.
 *
 * A GUEST IS NOT AN ERROR. Saving something before signing in is the point of
 * a wishlist on a shop someone is seeing for the first time, so these answer
 * `signedOut` and the browser keeps its local list (lib/wishlist.ts) until
 * there is an account to attach it to.
 */

/** Product ids are catalogue slugs. Bounded and character-checked because the
 *  value goes into a query and comes back out into the markup. */
const productId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/, 'Not a product id')

const toggleInput = z.object({ productId })
const mergeInput = z.object({
  // One page of saved items is a generous ceiling for a merge; a list longer
  // than this did not come from a person tapping hearts.
  ids: z.array(productId).max(200),
})

export type WishlistResult =
  | { ok: true; wishlist: string[]; saved?: boolean }
  | { ok: false; reason: 'signedOut' | 'invalid' | 'failed' }

/** Everything this customer has saved, newest first. */
export async function fetchWishlist(): Promise<WishlistResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, reason: 'signedOut' }

  const { data, error } = await createClient()
    .from('wishlist_items')
    .select('product_id')
    .order('created_at', { ascending: false })

  if (error) {
    console.error(`[wishlist] read failed: ${error.message}`)
    return { ok: false, reason: 'failed' }
  }
  return { ok: true, wishlist: (data ?? []).map((row) => row.product_id as string) }
}

/**
 * Adds or removes one product, and answers with the list that resulted.
 *
 * Returning the whole list rather than just "added" or "removed" is what lets
 * the client reconcile an optimistic toggle against the truth in one step:
 * two quick taps on the same heart, or the same product saved on a phone a
 * moment earlier, both end with the browser agreeing with the database.
 *
 * The DELETE decides. Asking "is it saved?" and then writing would be a race
 * with the customer's other device; deleting and looking at how many rows went
 * tells us which way the toggle actually went.
 */
export async function toggleWishlist(input: { productId: string }): Promise<WishlistResult> {
  const parsed = toggleInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid' }

  const user = await getCurrentUser()
  if (!user) return { ok: false, reason: 'signedOut' }

  const supabase = createClient()
  const { data: removed, error: deleteError } = await supabase
    .from('wishlist_items')
    .delete()
    .eq('product_id', parsed.data.productId)
    .select('id')

  if (deleteError) {
    console.error(`[wishlist] delete failed: ${deleteError.message}`)
    return { ok: false, reason: 'failed' }
  }

  let saved = false
  if ((removed ?? []).length === 0) {
    // Nothing was there, so this tap is a save. The unique (user_id,
    // product_id) constraint makes a double-tap harmless rather than a
    // duplicate row, so the conflict is ignored rather than reported.
    const { error: insertError } = await supabase
      .from('wishlist_items')
      .upsert(
        { user_id: user.id, product_id: parsed.data.productId },
        { onConflict: 'user_id,product_id', ignoreDuplicates: true },
      )

    if (insertError) {
      console.error(`[wishlist] insert failed: ${insertError.message}`)
      return { ok: false, reason: 'failed' }
    }
    saved = true
  }

  const list = await fetchWishlist()
  return list.ok ? { ...list, saved } : list
}

/**
 * Folds a guest's local list into their account, once, at sign-in.
 *
 * ADDITIVE, NEVER SUBTRACTIVE. The two lists are merged rather than one
 * replacing the other: someone who saved a coat on their phone last week and
 * a bag on this laptop five minutes ago should sign in and find both. Treating
 * the local list as authoritative would delete the phone's; treating the
 * server's as authoritative would discard what they just did.
 *
 * Idempotent, because the unique constraint absorbs anything already saved —
 * so a second sign-in, or a retried action, changes nothing.
 */
export async function mergeWishlist(input: { ids: string[] }): Promise<WishlistResult> {
  const parsed = mergeInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid' }

  const user = await getCurrentUser()
  if (!user) return { ok: false, reason: 'signedOut' }

  if (parsed.data.ids.length > 0) {
    const { error } = await createClient()
      .from('wishlist_items')
      .upsert(
        parsed.data.ids.map((id) => ({ user_id: user.id, product_id: id })),
        { onConflict: 'user_id,product_id', ignoreDuplicates: true },
      )

    if (error) {
      // Reported, not thrown: a wishlist that failed to merge must not break
      // the sign-in the customer actually came here to do.
      console.error(`[wishlist] merge failed: ${error.message}`)
      return { ok: false, reason: 'failed' }
    }
  }

  return fetchWishlist()
}
