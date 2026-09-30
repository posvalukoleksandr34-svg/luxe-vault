import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  ADMIN_SESSION_COOKIE,
  LEGACY_ADMIN_SESSION_COOKIE,
  verifySessionToken,
} from '@/lib/server/admin-auth'
import { revokeSession } from '@/lib/server/admin-sessions'

/**
 * Signing out revokes the session on the SERVER (admin-sessions.ts), not only
 * the cookie in this browser: a copy of the token taken earlier stops working
 * at the same moment. Clearing the cookie alone left such a copy valid for up
 * to 8 hours.
 */
export async function POST() {
  const session = await verifySessionToken((await cookies()).get(ADMIN_SESSION_COOKIE)?.value)
  if (session) {
    try {
      await revokeSession(session.nonce)
    } catch (e) {
      console.error('[admin/logout]', (e as Error).message)
      return NextResponse.json({ error: 'Sign-out failed, try again' }, { status: 503 })
    }
  }

  const response = NextResponse.json({ ok: true })
  for (const name of [ADMIN_SESSION_COOKIE, LEGACY_ADMIN_SESSION_COOKIE]) {
    response.cookies.set(name, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  }
  return response
}
