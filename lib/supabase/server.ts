import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireSupabaseEnv } from './env'

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * Runs as the signed-in user, so every query is subject to RLS.
 *
 * Note on the empty catch: Server Components are not allowed to set cookies.
 * Token refresh is handled centrally by the middleware, so swallowing the
 * write here is correct — it is not hiding a real failure.
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv()
  const cookieStore = cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component — middleware owns the refresh.
        }
      },
    },
  })
}

/**
 * The authenticated user, or null.
 *
 * Always uses getUser() rather than getSession(): getSession() only decodes
 * the cookie and trusts it, while getUser() revalidates the token against
 * Supabase Auth. Anything that gates access must use this.
 */
export async function getCurrentUser() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
