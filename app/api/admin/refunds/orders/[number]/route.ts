import { NextResponse } from 'next/server'

import { evaluateEligibility } from '@/lib/refunds/eligibility'
import { orderNumberSchema } from '@/lib/refunds/schemas'
import { requireAdmin } from '@/lib/server/admin-guard'
import { loadOrderFacts, toEligibilityOrder } from '@/lib/server/refunds/order-facts'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/** What may be claimed on an order — for a case staff file on a customer's behalf. */
export async function GET(_request: Request, props: { params: Promise<{ number: string }> }) {
  const { number } = await props.params
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.create')
  if (!gate.ok) return gate.response
  const parsed = orderNumberSchema.safeParse(number.toUpperCase())
  const order = parsed.success ? await loadOrderFacts({ number: parsed.data }) : null
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  const policy = await activePolicy()
  const eligibility = evaluateEligibility(toEligibilityOrder(order), policy.config, Date.now())
  return NextResponse.json(
    {
      order: {
        number: order.number,
        status: order.status,
        paymentStatus: order.paymentStatus,
        customerName: order.customerName,
        totalMinor: order.totalMinor,
        refundedMinor: order.refundedMinor,
        guest: !order.userId,
      },
      lines: order.lines,
      eligibility,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
