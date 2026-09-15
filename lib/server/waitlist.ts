// The back-in-stock waitlist (public.waitlist, migration 0031). One writer
// for both entry points — the joinWaitlist Server Action and the older
// /api/stock-alerts route — so the checks cannot drift apart.
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmail } from '@/lib/validation'

export type WaitlistError = 'INVALID_EMAIL' | 'UNKNOWN_VARIANT' | 'IN_STOCK' | 'FAILED'
export type WaitlistOutcome = { ok: true; already: boolean } | { ok: false; error: WaitlistError }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Signs an address up for one variant.
 *
 * The variant is resolved here, never trusted: by its id when the page knows
 * it, otherwise by size + colour — and in both cases it must belong to the
 * product named. Only a variant that is actually sold out takes sign-ups:
 * one that is in stock would fire on the next sweep and read as spam about
 * something the customer could simply have bought.
 */
export async function addToWaitlist(input: {
  productSlug: string
  variantId?: string
  size?: string
  color?: string
  email: string
  userId?: string
}): Promise<WaitlistOutcome> {
  const email = input.email.trim().toLowerCase()
  if (!isValidEmail(email)) return { ok: false, error: 'INVALID_EMAIL' }

  const supabase = createAdminClient()
  let query = supabase
    .from('product_variants')
    .select('id, product_id, stock, products!inner ( slug )')
    .eq('products.slug', input.productSlug)
  if (input.variantId && UUID.test(input.variantId)) {
    query = query.eq('id', input.variantId)
  } else {
    if (!input.size || !input.color) return { ok: false, error: 'UNKNOWN_VARIANT' }
    query = query.eq('size', input.size).eq('color', input.color)
  }

  const { data: variant, error: readError } = await query.maybeSingle()
  if (readError) {
    console.error('[waitlist] variant lookup failed:', readError.message)
    return { ok: false, error: 'FAILED' }
  }
  if (!variant) return { ok: false, error: 'UNKNOWN_VARIANT' }
  if (Number(variant.stock) > 0) return { ok: false, error: 'IN_STOCK' }

  // The database sets product_id from the variant as well (0031's trigger),
  // so the two can never disagree.
  const { error } = await supabase.from('waitlist').insert({
    email,
    product_id: variant.product_id,
    variant_id: variant.id,
    user_id: input.userId ?? null,
  })

  if (error) {
    // 23505 is the one-live-sign-up-per-variant index. Already on the list is
    // a success from the customer's side: they will be told.
    if (error.code === '23505') return { ok: true, already: true }
    console.error('[waitlist] insert failed:', error.message)
    return { ok: false, error: 'FAILED' }
  }
  return { ok: true, already: false }
}
