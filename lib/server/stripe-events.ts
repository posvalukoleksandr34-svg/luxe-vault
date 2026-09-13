import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Exactly-once processing for Stripe webhook events — see migration 0027.
 *
 * `claimStripeEvent` inserts the event id; the primary key makes that insert
 * the claim. One delivery wins, every redelivery (Stripe's retries, a
 * dashboard "resend", two instances at once) is told it is a duplicate.
 *
 * Deliberately tolerant of the table not existing yet: the handlers are still
 * idempotent on their own (status writes, the receipt claim), so a deployment
 * ahead of its migration keeps working — it just loses the stronger guarantee,
 * and says so once in the log.
 */

export type EventClaim = 'claimed' | 'duplicate' | 'unavailable'

let warnedMissing = false

export async function claimStripeEvent(id: string, type: string): Promise<EventClaim> {
  const { error } = await createAdminClient().from('stripe_events').insert({ id, type })
  if (!error) return 'claimed'
  if (error.code === '23505') return 'duplicate'

  if (error.code === '42P01' || error.code === 'PGRST205') {
    if (!warnedMissing) {
      warnedMissing = true
      console.warn('[stripe] stripe_events is missing — apply migration 0027 for event idempotency.')
    }
  } else {
    // The ledger itself failing must not block a payment update; the handlers
    // below are safe to repeat.
    console.warn(`[stripe] could not record event ${id}: ${error.message}`)
  }
  return 'unavailable'
}

/**
 * Gives a claim back after the work failed, so Stripe's retry can claim it
 * again. Without this a transient database error would mark an event as
 * processed that never was.
 */
export async function releaseStripeEvent(id: string): Promise<void> {
  const { error } = await createAdminClient().from('stripe_events').delete().eq('id', id)
  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    console.warn(`[stripe] could not release event ${id}: ${error.message}`)
  }
}
