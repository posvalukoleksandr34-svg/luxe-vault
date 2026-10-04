import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { isValidName } from '@/lib/validation'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * Updates the customer's display name.
 *
 * It also took an optional date of birth (migration 0035). Nothing in the
 * shop ever used it, so it is no longer collected; migration 0050 deletes the
 * stored values and the column.
 *
 * WHY THIS IS A ROUTE AND NOT A BROWSER WRITE
 *
 * The first version updated `profiles` directly from the browser client. It
 * silently did nothing: PostgREST reports success for an UPDATE that matched
 * zero rows, which is exactly what an RLS refusal looks like, so the customer
 * got a "saved" toast for a change that never happened. Every other table
 * access in this codebase already goes through a route with the request-scoped
 * client — the browser client is used only for `auth.*` — and this is now
 * consistent with that.
 *
 * The name lives in two places and both are written here:
 *
 *   profiles.name        what the app reads and renders
 *   auth metadata `name` what handle_new_user (0001) seeds from, and what the
 *                        transactional emails address the customer by
 *
 * The metadata key is `name`, NOT `full_name`: the signup trigger reads
 * `raw_user_meta_data ->> 'name'`, so any other key would be written and never
 * read again.
 *
 * Email and password are deliberately NOT handled here. Both go through
 * `supabase.auth.updateUser` in the browser, which owns identity — email
 * because it must send a confirmation link to the new address before switching,
 * password because the active session is the only thing that authorises it.
 */
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('account.write', user.id)
  if (limited) return limited

  const body = await readJsonObject<{ name?: unknown }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const update: { name?: string } = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!isValidName(name)) {
      return NextResponse.json({ error: 'INVALID_NAME' }, { status: 400 })
    }
    update.name = name
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // Request-scoped, so the RLS policy from 0001 is what authorises the write —
  // the same rule that would refuse someone else's row.
  const { data, error } = await createClient()
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select('id')

  if (error) {
    console.error('[account/profile] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save the profile' }, { status: 500 })
  }

  // Zero rows means RLS refused. Reported rather than swallowed: a silent
  // no-op here is the bug this route was written to fix.
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'NOT_SAVED' }, { status: 409 })
  }

  if (update.name) {
    // Metadata needs the admin client — a user cannot rewrite their own
    // `raw_user_meta_data` through the anon key. Non-fatal: the profile row is
    // what the UI reads, and a stale metadata copy only affects how a future
    // email greets them.
    const { error: metaError } = await createAdminClient().auth.admin.updateUserById(user.id, {
      user_metadata: { name: update.name },
    })
    if (metaError) {
      console.warn('[account/profile] metadata sync failed:', metaError.message)
    }
  }

  return NextResponse.json({ ok: true, name: update.name })
}
