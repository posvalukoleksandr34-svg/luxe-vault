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
 * Access tokens are short-lived. Without a refresh the server would start
 * seeing a signed-in visitor as anonymous well before the browser does. This
 * runs in middleware so both sides always agree — for page navigations that
 * carry a session; middleware.ts (needsSessionRefresh) skips everything else.
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
    return { response }
  }

  // A malformed URL cannot be recovered from here, and attempting it would
  // make every single request wait on a DNS failure. Warn once per boot and
  // pass the request through untouched instead.
  const urlProblem = describeUrlProblem(SUPABASE_URL!)
  if (urlProblem) {
    warnBadUrlOnce(urlProblem)
    return { response }
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

  // getClaims(): refreshes an expiring token (which is what writes the rotated
  // cookies above) and then verifies the JWT. With the project on asymmetric
  // JWT signing keys (Supabase → Project Settings → JWT Keys) it verifies
  // locally against the cached public key — no round trip to the Auth server
  // on every navigation. On the legacy shared secret it falls back to
  // getUser(), exactly what this called before. Nothing here authorises
  // anything: API routes and server actions check the user themselves.
  await supabase.auth.getClaims()

  return { response }
}

/**
 * Whether the request carries a Supabase session at all.
 *
 * @supabase/ssr keeps it in `sb-<project>-auth-token`, split into `.0`, `.1`…
 * when large. No such cookie, nothing to refresh — which is every visitor who
 * has not signed in.
 */
export function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name, value }) => value !== '' && /^sb-.+-auth-token(\.\d+)?$/.test(name))
}

/** Copies refreshed auth cookies onto a different response (e.g. a redirect). */
export function withAuthCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie))
  return target
}
