import { NextResponse, type NextRequest } from 'next/server'
import { evaluateEligibility } from '@/lib/refunds/eligibility'
import type { ClaimType } from '@/lib/refunds/types'
import { createReturnRequestSchema, firstIssue } from '@/lib/returns/schema'
import { readJsonObject } from '@/lib/server/http'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { createCase } from '@/lib/server/refunds/create'
import { summarise } from '@/lib/server/refunds/customer-view'
import { loadOrderFacts, toEligibilityOrder } from '@/lib/server/refunds/order-facts'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * The first return form's endpoint (a reason, a comment, photos — the whole
 * order), kept for any page still calling it. It files a refund CASE exactly
 * as /api/refunds/cases does — same eligibility, ownership, policy and
 * workflow — covering every unit of the order still free to claim, with the
 * claim type's default resolution. It never moved money and still does not.
 */
const REASON_TO_CLAIM: Record<string, ClaimType> = {
  wrong_size: 'wrong_size',
  defective: 'defective',
  not_as_described: 'not_as_described',
  changed_mind: 'changed_mind',
  other: 'other',
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('refunds.write', user.id)
  if (limited) return limited

  const body = (await readJsonObject<Record<string, unknown>>(request)) ?? {}
  // The order number comes from the ROUTE, never the body.
  const parsed = createReturnRequestSchema.safeParse({ ...body, orderNumber: params.id })
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })

  const order = await loadOrderFacts({ number: params.id })
  if (!order || order.userId !== user.id) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const claimType = REASON_TO_CLAIM[parsed.data.reason] ?? 'other'
  const policy = await activePolicy()
  const claim = evaluateEligibility(toEligibilityOrder(order), policy.config, Date.now()).claims[claimType]
  if (!claim.allowed) {
    return NextResponse.json({ error: 'ALREADY_OPEN', alreadyRequested: claim.refused === 'nothing_left_to_claim', refused: claim.refused }, { status: 409 })
  }

  const result = await createCase({
    orderNumber: order.number,
    claimType,
    resolution: claim.resolutions[0],
    lines: claim.lines.map((l) => ({ orderItemId: l.orderItemId, qty: l.available })),
    description: parsed.data.comment,
    photos: parsed.data.images,
    actor: { type: 'customer', userId: user.id, label: 'customer' },
  })
  if (!result.ok) return NextResponse.json({ error: result.code, message: result.message }, { status: result.status })
  return NextResponse.json({ ok: true, request: summarise(result.case) })
}
