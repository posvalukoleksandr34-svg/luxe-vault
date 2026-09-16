import { NextResponse, type NextRequest } from 'next/server'
import { REFERRAL_COOKIE } from '@/lib/referral-program'
import { enforceLimit } from '@/lib/server/rate-limit'
import { claimReferral, normaliseReferralCode } from '@/lib/server/referrals'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Links a newly signed-in customer to the friend whose link brought them.
 *
 * The code comes from the referral cookie, never the body, and the customer
 * from the session: nobody can attach themselves to a code they did not
 * arrive through, or attach somebody else. Only new accounts with no orders
 * qualify (see claimReferral). Safe to call repeatedly.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('referral.claim', request)
  if (limited) return limited

  const user = await getCurrentUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const code = normaliseReferralCode(request.cookies.get(REFERRAL_COOKIE)?.value)
  if (!code) return NextResponse.json({ result: 'ineligible' })

  const result = await claimReferral({
    code,
    userId: user.id,
    email: user.email,
    accountCreatedAt: user.created_at,
  })
  return NextResponse.json({ result })
}
