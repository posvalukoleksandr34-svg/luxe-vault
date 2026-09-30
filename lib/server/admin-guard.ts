import 'server-only'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ADMIN_SESSION_COOKIE, verifySessionToken } from '@/lib/server/admin-auth'
import { sessionState } from '@/lib/server/admin-sessions'

/**
 * Defence in depth for the admin console.
 *
 * middleware.ts is the first gate for /admin and /api/admin, but it must not
 * be the only one: a middleware bypass (CVE-2025-29927 was exactly that — an
 * `x-middleware-subrequest` header that skipped middleware entirely), a matcher
 * edited to exclude a path, or a route moved outside /api/admin would each
 * leave the console open. Every admin handler therefore re-checks the signed
 * session cookie itself: the HMAC verification the middleware runs, which
 * fails closed on a missing, expired or forged token and on a server whose
 * admin secrets are not configured — and then, which the Edge middleware
 * cannot do, whether that session has been signed out (admin-sessions.ts).
 *
 * Kept out of admin-auth.ts because that file is imported by the Edge
 * middleware and `next/headers` belongs to the request-handling runtime.
 */
export async function isAdminRequest(): Promise<boolean> {
  try {
    const session = await verifySessionToken((await cookies()).get(ADMIN_SESSION_COOKIE)?.value)
    if (!session) return false
    // And not signed out since: a copied token dies with the session it came
    // from (admin-sessions.ts). 'unmigrated' keeps the pre-0047 behaviour.
    const state = await sessionState(session.nonce)
    return state === 'active' || state === 'unmigrated'
  } catch {
    return false
  }
}

/**
 * For route handlers: `const denied = await requireAdmin(); if (denied) return denied`.
 * Answers with the same 401 body the middleware uses.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (await isAdminRequest()) return null
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
