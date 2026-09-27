'use client'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The browser's Supabase client, loaded on first use.
 *
 * supabase-js with its auth and realtime modules is ~70 KB of compressed
 * script. It used to be imported by the root store, so every page shipped it
 * and every visitor ran it, including the large majority who never sign in.
 * Importing it through here puts it in its own chunk, fetched the first time
 * something actually needs Supabase: a session to restore, a sign-in, an
 * account form.
 *
 * One shared promise, so concurrent first uses load it once. A failed load
 * (a chunk that did not download) is forgotten, so the next use retries.
 */
let client: Promise<SupabaseClient> | null = null

export function loadSupabase(): Promise<SupabaseClient> {
  if (!client) {
    client = import('./client')
      .then(({ createClient }) => createClient())
      .catch((error) => {
        client = null
        throw error
      })
  }
  return client
}

/**
 * Whether this browser holds a Supabase session to restore — without loading
 * Supabase to find out.
 *
 * @supabase/ssr keeps the session in cookies named `sb-<project>-auth-token`,
 * split into `.0`, `.1`… when large, and readable by script (the browser
 * client needs them). The PKCE `…-auth-token-code-verifier` cookie of a
 * sign-in still in progress deliberately does not count: there is no session
 * until the callback has set one.
 */
export function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie
    .split(';')
    .some((cookie) => /^\s*sb-[^=]*-auth-token(\.\d+)?=./.test(cookie))
}
