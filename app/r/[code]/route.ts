import { NextResponse, type NextRequest } from 'next/server'
import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS } from '@/lib/referral-program'
import { checkLimit, clientKey } from '@/lib/server/rate-limit'
import { normaliseReferralCode, recordReferralClick, referrerForCode } from '@/lib/server/referrals'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * A referral link: /r/REF-XXXXXX.
 *
 * Records the visit, remembers the code for 30 days so checkout can offer the
 * friend's discount, and sends the visitor to the homepage. Always redirects —
 * an unknown code, a throttled visitor or the referrer clicking their own link
 * simply land on the shop without the click being counted.
 *
 * A repeat visit with the same code already in the cookie is not counted
 * again, so one friend opening the link five times is one click.
 */
export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const home = new URL('/', request.url)
  const response = NextResponse.redirect(home, 307)
  response.headers.set('X-Robots-Tag', 'noindex')

  const code = normaliseReferralCode(decodeURIComponent(params.code))
  if (!code) return response

  const referrerId = await referrerForCode(code)
  if (!referrerId) return response

  let viewerId: string | undefined
  try {
    viewerId = (await getCurrentUser())?.id
  } catch {
    // Anonymous visitor.
  }
  if (viewerId === referrerId) return response

  const alreadyCounted = request.cookies.get(REFERRAL_COOKIE)?.value?.toUpperCase() === code
  if (!alreadyCounted) {
    const limit = await checkLimit('referral.click', clientKey(request))
    if (limit.allowed) await recordReferralClick(referrerId)
  }

  response.cookies.set(REFERRAL_COOKIE, code, {
    path: '/',
    maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    httpOnly: false,
  })
  return response
}
