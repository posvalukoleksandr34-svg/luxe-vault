import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  describeUrlProblem,
  isSupabaseConfigured,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './env'

let warnedBadUrl = false
function warnBadUrlOnce(problem: string) {
  if (warnedBadUrl) return
  warnedBadUrl = true
  console.error(
    `[supabase] Auth disabled — NEXT_PUBLIC_SUPABASE_URL is unusable: ${problem}`,
  )
}

/**
 * Refreshes the Supabase auth token on the incoming request.
 *
 * Access tokens are short-lived. Without a refresh on each request the server
 * would start seeing a signed-in visitor as anonymous well before the browser
 * does. This runs in middleware so both sides always agree.
 *
 * The returned `response` carries the rotated cookies and MUST be the response
 * that is eventually sent — or, when redirecting, its cookies must be copied
 * onto the redirect (see `withAuthCookies` below). Dropping them silently
 * signs the user out on the next navigation.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  if (!isSupabaseConfigured) {
    // Supabase not wired up yet — leave the request untouched so the rest of
    // the site (and /admin, which has its own auth) keeps working.
    return { response, user: null }
  }

  // A malformed URL cannot be recovered from here, and attempting it would
  // make every single request wait on a DNS failure. Warn once per boot and
  // pass the request through untouched instead.
  const urlProblem = describeUrlProblem(SUPABASE_URL!)
  if (urlProblem) {
    warnBadUrlOnce(urlProblem)
    return { response, user: null }
  }

  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // getUser(), never getSession(): getSession only decodes the cookie and
  // trusts whatever it finds, whereas getUser revalidates the token with the
  // Auth server. This call is also what triggers the refresh above.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user }
}

/** Copies refreshed auth cookies onto a different response (e.g. a redirect). */
export function withAuthCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie))
  return target
}
