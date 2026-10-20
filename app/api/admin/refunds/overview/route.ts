import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { overview } from '@/lib/server/refunds/admin-queries'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/** The console's figures: queues, risk, refunds, SLA. */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.view')
  if (!gate.ok) return gate.response
  const policy = await activePolicy()
  return NextResponse.json(await overview(policy.config.sla.decisionDays), { headers: { 'Cache-Control': 'no-store' } })
}
