import { NextResponse } from 'next/server'
import type { AppCodeView } from '@/lib/promo-codes'
import { appCodeFor } from '@/lib/server/promo-codes'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * The signed-in customer's personal app code.
 *
 *   GET   what they have — never issues one
 *   POST  issues it if they have none (the installed app calls this on its
 *         first launch after sign-in, and from the account screen)
 *
 * One code per account, whatever calls this and however often: see
 * appCodeFor(). Signed out, the answer is `signed_out` rather than 401, so
 * the app can show "sign in to get your code" without treating it as an
 * error.
 */
async function answer(issue: boolean) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ status: 'signed_out' } satisfies AppCodeView, { headers: NO_STORE })
    return NextResponse.json(await appCodeFor(user.id, { issue }), { headers: NO_STORE })
  } catch (e) {
    console.error('[app/welcome-code] failed:', e)
    return NextResponse.json({ status: 'unavailable' } satisfies AppCodeView, { status: 500, headers: NO_STORE })
  }
}

export function GET() {
  return answer(false)
}

export function POST() {
  return answer(true)
}
