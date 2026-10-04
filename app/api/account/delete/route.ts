import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { getStripe, isStripeConfigured } from '@/lib/server/stripe'
import { getStripeCustomerId } from '@/lib/server/stripe-customer'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * Deletes the signed-in customer's account — the erasure the privacy policy
 * promises, without having to write in for it.
 *
 * The customer confirms by typing their account's email address: deletion
 * cannot be undone, and a session cookie alone (a borrowed laptop) should not
 * be enough to do it in one click.
 *
 * WHAT GOES
 *   - the Stripe customer, and with it every saved card (deleted at Stripe
 *     first: if that fails nothing else is touched, so no card is left behind
 *     with no account to remove it from);
 *   - newsletter subscription, store reviews, stock alerts, waitlist entries
 *     and any pending cart reminder for the account's address, including ones
 *     made before signing in;
 *   - the auth user, which cascades to the profile, addresses, wishlist,
 *     saved looks, notifications, product reviews, referral code, credits and
 *     coupons (each table's foreign key is `on delete cascade`).
 *
 * WHAT STAYS, detached from the account (`on delete set null`)
 *   - orders and return requests: kept for the limitation period the privacy
 *     policy states (5 years), as the record of a sale;
 *   - support tickets: kept for the period the policy states (24 months).
 * These keep the contact details given on them. A customer who wants those
 * erased too writes to support; the policy says so.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('account.delete', user.id)
  if (limited) return limited

  const body = await readJsonObject<{ email?: unknown }>(request)
  const typed = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const email = (user.email ?? '').trim().toLowerCase()
  if (!email || typed !== email) {
    return NextResponse.json({ error: 'CONFIRMATION_MISMATCH' }, { status: 400 })
  }

  // 1. Stripe first: saved cards must not outlive the account.
  if (isStripeConfigured()) {
    const customerId = await getStripeCustomerId(user.id)
    if (customerId) {
      try {
        await getStripe().customers.del(customerId)
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code !== 'resource_missing') {
          console.error('[account/delete] Stripe customer not deleted:', (e as Error).message)
          return NextResponse.json({ error: 'TRY_LATER' }, { status: 503 })
        }
      }
    }
  }

  const admin = createAdminClient()

  // 2. Rows keyed by the address as well as by the user: a newsletter
  //    subscription or stock alert made before signing in has no user_id.
  const byEmail: Array<[string, string]> = [
    ['newsletter_subscribers', 'email'],
    ['stock_alerts', 'email'],
    ['waitlist', 'email'],
    ['abandoned_carts', 'email'],
  ]
  for (const [table, column] of byEmail) {
    const { error } = await admin.from(table).delete().eq(column, email)
    if (error && !['42P01', 'PGRST205'].includes(error.code)) {
      console.error(`[account/delete] ${table} not cleared:`, error.message)
      return NextResponse.json({ error: 'TRY_LATER' }, { status: 503 })
    }
  }
  //    Store reviews are published under the author's name; detaching them
  //    (the foreign key's `set null`) would leave the name up.
  {
    const { error } = await admin.from('site_reviews').delete().eq('user_id', user.id)
    if (error && !['42P01', 'PGRST205'].includes(error.code)) {
      console.error('[account/delete] site_reviews not cleared:', error.message)
      return NextResponse.json({ error: 'TRY_LATER' }, { status: 503 })
    }
  }

  // 3. The auth user — everything keyed `on delete cascade` goes with it.
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) {
    console.error('[account/delete] auth user not deleted:', error.message)
    return NextResponse.json({ error: 'TRY_LATER' }, { status: 503 })
  }

  // 4. This browser's session cookies. The tokens are already worthless.
  try {
    await (await createClient()).auth.signOut()
  } catch {
    // Nothing to clear.
  }
  return NextResponse.json({ deleted: true })
}
