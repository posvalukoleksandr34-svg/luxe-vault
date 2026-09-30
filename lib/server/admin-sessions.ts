import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The server-side half of an admin session: which signed tokens are still
 * live. See supabase/migrations/0047_admin_sessions.sql for why it exists.
 *
 * Three answers, deliberately distinct:
 *
 *   'active'      the nonce was issued by a login, is unrevoked and unexpired.
 *   'refused'     unknown, revoked or expired — or the database could not be
 *                 read. Fails CLOSED: an admin check that cannot be completed
 *                 is a no.
 *   'unmigrated'  the table does not exist yet (migration 0047 not applied).
 *                 The caller falls back to the signature-and-expiry check the
 *                 console had before, so deploying before migrating does not
 *                 lock the admin out; it is logged every time.
 */
export type SessionState = 'active' | 'refused' | 'unmigrated'

const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

function logUnmigrated() {
  console.error(
    '[admin-sessions] public.admin_sessions is missing — apply migration 0047. ' +
      'Until then signing out cannot revoke a copied admin session token.',
  )
}

export async function recordSession(session: {
  nonce: string
  expiresAt: number
  ip?: string
  userAgent?: string
}): Promise<'recorded' | 'unmigrated'> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('admin_sessions').insert({
    nonce: session.nonce,
    expires_at: new Date(session.expiresAt * 1000).toISOString(),
    ip: session.ip?.slice(0, 64) || null,
    user_agent: session.userAgent?.slice(0, 300) || null,
  })
  if (error) {
    if (MISSING_TABLE.has(error.code)) {
      logUnmigrated()
      return 'unmigrated'
    }
    throw new Error(`Failed to record admin session: ${error.message}`)
  }
  // Housekeeping on the rare write path: rows past their expiry are useless.
  await supabase.from('admin_sessions').delete().lt('expires_at', new Date().toISOString())
  return 'recorded'
}

export async function sessionState(nonce: string): Promise<SessionState> {
  try {
    const { data, error } = await createAdminClient()
      .from('admin_sessions')
      .select('expires_at, revoked_at')
      .eq('nonce', nonce)
      .maybeSingle()
    if (error) {
      if (MISSING_TABLE.has(error.code)) {
        logUnmigrated()
        return 'unmigrated'
      }
      console.error(`[admin-sessions] read failed: ${error.message}`)
      return 'refused'
    }
    if (!data || data.revoked_at) return 'refused'
    return Date.parse(data.expires_at as string) > Date.now() ? 'active' : 'refused'
  } catch (e) {
    console.error(`[admin-sessions] read failed: ${(e as Error).message}`)
    return 'refused'
  }
}

/** Signing out: the token stops working everywhere, at once. */
export async function revokeSession(nonce: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('admin_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('nonce', nonce)
    .is('revoked_at', null)
  if (error && !MISSING_TABLE.has(error.code)) {
    throw new Error(`Failed to revoke admin session: ${error.message}`)
  }
}
