import { NextResponse } from 'next/server'
import { referralOverview } from '@/lib/server/referrals'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * The signed-in customer's referral programme: their code and link (minted on
 * first request), the offer, stats and history. `available: false` until
 * migration 0036 is applied.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await referralOverview(user.id), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
