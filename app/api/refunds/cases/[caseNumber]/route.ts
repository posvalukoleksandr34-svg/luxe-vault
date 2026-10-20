import { NextResponse } from 'next/server'

import { caseNumberSchema } from '@/lib/refunds/schemas'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { getCaseByNumber } from '@/lib/server/refunds/cases'
import { customerCaseDetail } from '@/lib/server/refunds/customer-view'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** One of the signed-in customer's requests, as they may see it (customer-view.ts). */
export async function GET(_request: Request, props: { params: Promise<{ caseNumber: string }> }) {
  const { caseNumber } = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('refunds.read', user.id)
  if (limited) return limited

  const parsed = caseNumberSchema.safeParse(caseNumber)
  const c = parsed.success ? await getCaseByNumber(parsed.data) : null
  // Another customer's case, and no case at all, answer the same.
  if (!c || c.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ case: await customerCaseDetail(c) }, { headers: { 'Cache-Control': 'no-store' } })
}
