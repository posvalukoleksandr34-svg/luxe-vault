import 'server-only'

import { getSiteUrl } from '@/lib/site-url'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CartItem } from '@/lib/types'

/**
 * Abandoned carts (migration 0029): a cart whose owner typed an email at
 * checkout and never ordered. Everything here uses the service role — the
 * table holds email addresses and has no RLS policies at all — and nothing
 * here throws into a customer-facing request: capture and "mark recovered"
 * are side effects of checkout, never reasons for it to fail.
 */

export type AbandonedCart = {
  id: string
  email: string
  cart_items: CartItem[]
  checkout_url: string | null
  status: 'pending' | 'recovered' | 'expired'
  locale: string | null
  token: string
  reminder_sent_at: string | null
  opted_out_at: string | null
  updated_at: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A restore / opt-out token as issued by capture_abandoned_cart. */
export function isCartToken(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/**
 * Saves (or refreshes) the pending cart for this address and returns its
 * token. One pending cart per address: a later capture replaces the items and
 * pushes the "left untouched since" clock forward.
 */
export async function captureAbandonedCart(
  email: string,
  items: CartItem[],
  locale: string,
): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient().rpc('capture_abandoned_cart', {
      p_email: email,
      p_items: items,
      p_locale: locale,
      p_checkout_base: `${getSiteUrl()}/cart/restore/`,
    })
    if (error) throw new Error(error.message)
    return typeof data === 'string' ? data : null
  } catch (e) {
    // Migration 0029 not applied yet, or the database unreachable.
    console.warn('[abandoned-carts] capture skipped:', (e as Error).message)
    return null
  }
}

/** The customer ordered: their pending cart needs no reminder. */
export async function markCartRecovered(email: string | undefined): Promise<void> {
  const address = email?.trim().toLowerCase()
  if (!address) return
  try {
    const { error } = await createAdminClient()
      .from('abandoned_carts')
      .update({ status: 'recovered', updated_at: new Date().toISOString() })
      .eq('email', address)
      .eq('status', 'pending')
    if (error) throw new Error(error.message)
  } catch (e) {
    console.warn('[abandoned-carts] mark-recovered skipped:', (e as Error).message)
  }
}

/**
 * Claims the carts due a reminder — pending, untouched for two hours, never
 * reminded, address not opted out and not reminded in the last week, and not
 * followed by an order — stamping reminder_sent_at in the same statement.
 * Carts idle for a week are expired on the way. Safe to run concurrently.
 * Throws: the cron reports it.
 */
export async function claimDueCarts(limit = 100): Promise<AbandonedCart[]> {
  const { data, error } = await createAdminClient().rpc('claim_abandoned_carts', { p_limit: limit })
  if (error) throw new Error(error.message)
  return (data ?? []) as AbandonedCart[]
}

export async function findCartByToken(
  token: string,
): Promise<Pick<AbandonedCart, 'cart_items' | 'status'> | null> {
  if (!isCartToken(token)) return null
  try {
    const { data, error } = await createAdminClient()
      .from('abandoned_carts')
      .select('cart_items, status')
      .eq('token', token)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as Pick<AbandonedCart, 'cart_items' | 'status'> | null) ?? null
  } catch (e) {
    console.warn('[abandoned-carts] lookup failed:', (e as Error).message)
    return null
  }
}

/**
 * No more cart reminders to this cart's address. Recorded on the row; the
 * claim excludes every cart of an address that has opted out once. The cart
 * itself stays restorable — opting out of email is not deleting a basket.
 */
export async function optOutCart(token: string): Promise<boolean> {
  if (!isCartToken(token)) return false
  try {
    const { error } = await createAdminClient()
      .from('abandoned_carts')
      .update({ opted_out_at: new Date().toISOString() })
      .eq('token', token)
    if (error) throw new Error(error.message)
    return true
  } catch (e) {
    console.warn('[abandoned-carts] opt-out failed:', (e as Error).message)
    return false
  }
}
