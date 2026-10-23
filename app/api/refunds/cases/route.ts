import { NextResponse, type NextRequest } from 'next/server'

import { createCaseSchema } from '@/lib/refunds/schemas'
import { readJsonObject } from '@/lib/server/http'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { createCase } from '@/lib/server/refunds/create'
import { customerCases, summarise } from '@/lib/server/refunds/customer-view'
import { getCurrentUser } from '@/lib/supabase/server'
import { customerUnmigrated } from '@/lib/server/refunds/schema'

export const dynamic = 'force-dynamic'

/**
 * A signed-in customer's refund and return requests.
 *
 *   GET   their requests, newest first (the account page);
 *   POST  a new request on one of their orders.
 *
 * Filing never moves money. It records what the customer asks for; a person
 * decides (Refund Policy: every request is reviewed by a human), and the
 * amount is computed on the server from the order as charged — a figure in
 * the body is not read.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('refunds.read', user.id)
  if (limited) return limited
  const unavailable = await customerUnmigrated()
  if (unavailable) return unavailable
  return NextResponse.json({ cases: await customerCases(user.id) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('refunds.write', user.id)
  if (limited) return limited
  const unavailable = await customerUnmigrated()
  if (unavailable) return unavailable

  const body = await readJsonObject(request)
  const parsed = createCaseSchema.safeParse(body ?? {})
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })

  const result = await createCase({
    orderNumber: parsed.data.orderNumber,
    claimType: parsed.data.claimType,
    resolution: parsed.data.resolution,
    lines: parsed.data.lines,
    description: parsed.data.description,
    photos: parsed.data.photos,
    submissionKey: parsed.data.submissionKey,
    actor: { type: 'customer', userId: user.id, label: 'customer' },
  })
  if (!result.ok) return NextResponse.json({ error: result.code, message: result.message }, { status: result.status })
  return NextResponse.json({ case: summarise(result.case), created: result.created }, { status: result.created ? 201 : 200 })
}
