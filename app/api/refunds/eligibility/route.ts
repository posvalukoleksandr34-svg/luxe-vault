import { NextResponse, type NextRequest } from 'next/server'

import { evaluateEligibility } from '@/lib/refunds/eligibility'
import { orderNumberSchema } from '@/lib/refunds/schemas'
import { CLAIM_TYPES } from '@/lib/refunds/types'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { casesForOrder } from '@/lib/server/refunds/cases'
import { loadOrderFacts, toEligibilityOrder } from '@/lib/server/refunds/order-facts'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * What the signed-in customer may claim on one of THEIR orders, and how —
 * computed on the server from the order and the policy in force
 * (lib/refunds/eligibility.ts). The request form shows this; the create
 * route computes it again on submission, so editing it in the browser
 * changes nothing.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('refunds.read', user.id)
  if (limited) return limited

  const parsed = orderNumberSchema.safeParse(request.nextUrl.searchParams.get('order'))
  if (!parsed.success) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  const order = await loadOrderFacts({ number: parsed.data })
  // Not theirs looks exactly like not there.
  if (!order || order.userId !== user.id) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const policy = await activePolicy()
  const result = evaluateEligibility(toEligibilityOrder(order), policy.config, Date.now())
  const cases = await casesForOrder(order.id)

  return NextResponse.json(
    {
      order: {
        number: order.number,
        status: order.status,
        shippedAt: order.shippedAt ?? null,
        deliveredAt: order.deliveredAt ?? null,
        totalMinor: order.totalMinor,
        refundedMinor: order.refundedMinor,
      },
      eligible: result.eligible,
      refused: result.refused ?? null,
      lines: order.lines.map((l) => {
        const e = result.lines.find((x) => x.orderItemId === l.orderItemId)
        return {
          orderItemId: l.orderItemId,
          name: l.name,
          image: l.image ?? null,
          size: l.size,
          color: l.color,
          qty: l.qty,
          available: e?.available ?? 0,
          nonReturnable: e?.nonReturnable ?? false,
        }
      }),
      claims: Object.fromEntries(
        CLAIM_TYPES.map((type) => {
          const c = result.claims[type]
          return [
            type,
            {
              allowed: c.allowed,
              refused: c.refused ?? null,
              needsReview: c.manualReview.length > 0,
              requireReturn: c.requireReturn,
              resolutions: c.resolutions,
              minPhotos: c.minPhotos,
              deadline: c.deadline ?? null,
              waitUntil: c.waitUntil ?? null,
              lines: c.lines,
            },
          ]
        }),
      ),
      openCases: cases
        .filter((c) => !['refunded', 'partially_refunded', 'resolved', 'rejected', 'cancelled', 'expired'].includes(c.state))
        .map((c) => ({ caseNumber: c.caseNumber, state: c.state })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
