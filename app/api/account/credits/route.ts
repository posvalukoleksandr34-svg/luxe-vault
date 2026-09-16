import { NextResponse } from 'next/server'
import { creditBalance } from '@/lib/server/referrals'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** The signed-in customer's bonus balance (account_credits, migration 0036),
 *  in the store's base currency. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await creditBalance(user.id), { headers: { 'Cache-Control': 'no-store' } })
}
