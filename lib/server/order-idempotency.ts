import 'server-only'

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * One order per checkout attempt (migration 0061 explains the problem).
 *
 * Checkout sends `idempotencyKey`, a random value per attempt, and re-sends
 * the same one when it retries the same attempt. /api/orders calls
 * claimOrderKey() before it creates anything and acts on the answer:
 *
 *   claimed      create the order, then recordOrderKey(); on any failure
 *                before that, releaseOrderKey() so the retry can try again
 *   existing     the order was already created: return it again
 *   in_progress  the first request is still working: 409, ask again shortly
 *   unavailable  no key, or the table is missing (0061 not applied) or
 *                unreachable: behave exactly as before, without the guard
 *
 * Only the key's SHA-256 is stored.
 */

/** A claim with no order this long belongs to a request that died. */
export const STALE_CLAIM_MS = 2 * 60_000

const MISSING = new Set(['42P01', 'PGRST205'])
const KEY = /^[A-Za-z0-9-]{16,64}$/

/** The key from the request body, or null when absent or malformed. */
export function parseIdempotencyKey(value: unknown): string | null {
  return typeof value === 'string' && KEY.test(value) ? value : null
}

export function hashIdempotencyKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export type KeyClaim =
  | { kind: 'claimed' }
  | { kind: 'existing'; orderNumber: string }
  | { kind: 'in_progress' }
  | { kind: 'unavailable' }

/**
 * What to do with a key whose row already exists. Pure, for the tests: an
 * order number means the order exists; none, and the claim is either live
 * (in progress) or stale (its request died and the key may be taken over).
 */
export function classifyExisting(
  row: { order_number: string | null; created_at: string },
  now: number = Date.now(),
): 'existing' | 'in_progress' | 'stale' {
  if (row.order_number) return 'existing'
  return now - new Date(row.created_at).getTime() > STALE_CLAIM_MS ? 'stale' : 'in_progress'
}

export async function claimOrderKey(key: string | null): Promise<KeyClaim> {
  if (!key) return { kind: 'unavailable' }
  const keyHash = hashIdempotencyKey(key)
  try {
    const supabase = createAdminClient()
    // Two passes at most: the second only after removing a stale claim.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await supabase.from('order_idempotency').insert({ key_hash: keyHash })
      if (!error) return { kind: 'claimed' }
      if (MISSING.has(error.code ?? '')) return { kind: 'unavailable' }
      if (error.code !== '23505') throw new Error(error.message)

      const { data, error: readError } = await supabase
        .from('order_idempotency')
        .select('order_number, created_at')
        .eq('key_hash', keyHash)
        .maybeSingle()
      if (readError) throw new Error(readError.message)
      // Deleted between the insert and the read (a release): try again.
      if (!data) continue

      const state = classifyExisting(data as { order_number: string | null; created_at: string })
      if (state === 'existing') return { kind: 'existing', orderNumber: (data as { order_number: string }).order_number }
      if (state === 'in_progress') return { kind: 'in_progress' }
      // Stale: remove it only if it is still the same orderless claim.
      await supabase.from('order_idempotency').delete().eq('key_hash', keyHash).is('order_number', null)
    }
    return { kind: 'in_progress' }
  } catch (e) {
    // The guard must never cost a sale: without it, checkout works as it did
    // before 0061. Logged so a persistent failure is visible.
    console.error('[orders] idempotency guard unavailable:', (e as Error).message)
    return { kind: 'unavailable' }
  }
}

/** The order now exists: a retry with this key gets it back. */
export async function recordOrderKey(key: string | null, orderNumber: string): Promise<void> {
  if (!key) return
  const { error } = await createAdminClient()
    .from('order_idempotency')
    .update({ order_number: orderNumber })
    .eq('key_hash', hashIdempotencyKey(key))
  if (error && !MISSING.has(error.code ?? '')) {
    // The order is real; only the replay protection for this one attempt is
    // lost (a retry would hit the in-progress state until the claim is
    // stale). Never fails the order.
    console.error('[orders] could not record the idempotency key:', error.message)
  }
}

/** No order was created: free the key so the customer's retry can proceed. */
export async function releaseOrderKey(key: string | null): Promise<void> {
  if (!key) return
  try {
    await createAdminClient()
      .from('order_idempotency')
      .delete()
      .eq('key_hash', hashIdempotencyKey(key))
      .is('order_number', null)
  } catch {
    // A claim left behind goes stale after STALE_CLAIM_MS and is taken over.
  }
}
