'use client'

import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseEnv } from './env'

/**
 * Browser-side Supabase client. Reads and writes the auth cookies that the
 * middleware refreshes, so the session the server sees and the session the
 * browser sees are always the same one.
 *
 * `createBrowserClient` memoises internally, so calling this per component is
 * cheap and still yields a single shared realtime/auth connection.
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv()
  return createBrowserClient(url, anonKey)
}
