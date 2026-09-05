import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Exchanges the one-time code in a Supabase email link for a real session.
 *
 * Both the signup-confirmation and the password-reset links land here. The
 * code is single-use and short-lived; exchanging it sets the auth cookies, at
 * which point the visitor is signed in and may set a new password.
 *
 * `next` decides where they end up afterwards — password resets go to
 * /auth/update-password. It is validated as a same-origin relative path so
 * this route cannot be used as an open redirect to an attacker's site.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/'

  // Must be a relative path, and must not start with `//` (protocol-relative
  // URLs like //evil.com would otherwise leave the site).
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/forgot-password?error=missing_code`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Expired or already-used link — send them back to request a fresh one
    // rather than dumping a raw Supabase error on the customer.
    return NextResponse.redirect(`${origin}/auth/forgot-password?error=invalid_link`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
