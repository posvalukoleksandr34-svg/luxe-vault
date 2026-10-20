import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { audit } from '@/lib/server/refunds/audit'
import { exportCsv, parseFilter } from '@/lib/server/refunds/admin-queries'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/** The filtered case list as CSV (case.export). Recorded in the audit trail. */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.export')
  if (!gate.ok) return gate.response
  const policy = await activePolicy()
  const filter = parseFilter(request.nextUrl.searchParams, gate.actor.staffId)
  const csv = await exportCsv(filter, policy.config.sla.decisionDays)
  await audit({ actor: gate.actor, action: 'cases.exported', data: { filter: Object.fromEntries(request.nextUrl.searchParams) } })
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="refund-cases-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
