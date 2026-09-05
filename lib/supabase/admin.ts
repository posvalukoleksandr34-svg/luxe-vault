import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describeUrlProblem, SUPABASE_URL } from './env'

/**
 * Service-role Supabase client.
 *
 * DANGER: this key bypasses Row Level Security completely. It must never be
 * imported into a client component, and the variable must never be renamed to
 * NEXT_PUBLIC_* — that would ship full database access to every browser.
 * `import 'server-only'` above turns any accidental client import into a build
 * error rather than a silent breach.
 *
 * This is the only way orders are written: totals, statuses and tracking
 * numbers are server-authored, never accepted from a browser.
 */
let cached: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (cached) return cached

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !serviceKey) {
    const missing = [
      !SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
      !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ]
      .filter(Boolean)
      .join(' and ')
    throw new Error(
      `Supabase admin client unavailable: ${missing} missing. ` +
        'Add it to .env.local (Project Settings → API → service_role) and restart.',
    )
  }

  const problem = describeUrlProblem(SUPABASE_URL)
  if (problem) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is unusable: ${problem}`)
  }

  cached = createClient(SUPABASE_URL, serviceKey, {
    // No cookie storage and no token refresh: this client is not a user
    // session, and persisting one server-side would leak between requests.
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
