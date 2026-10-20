import { NextResponse, type NextRequest } from 'next/server'

import { createCaseSchema } from '@/lib/refunds/schemas'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { listCases, parseFilter } from '@/lib/server/refunds/admin-queries'
import { createCase } from '@/lib/server/refunds/create'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/**
 * GET   the case list: filtered, sorted and paged in the database
 *       (?state=open|<states>&claim=&risk=&assigned=me|none|<id>&escalated=1
 *        &overdue=1&q=&from=&to=&sort=&page=&pageSize=).
 * POST  a case filed by staff for a customer (a phone call, an email, a
 *       guest order): the same eligibility and calculator as the customer's
 *       form, no photo minimum, recorded as source 'staff'.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.view')
  if (!gate.ok) return gate.response
  const policy = await activePolicy()
  const filter = parseFilter(request.nextUrl.searchParams, gate.actor.staffId)
  const result = await listCases(filter, policy.config.sla.decisionDays)
  return NextResponse.json(
    {
      ...result,
      rows: result.rows.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        orderNumber: c.orderNumber,
        customerName: c.customerName,
        claimType: c.claimType,
        state: c.state,
        requestedResolution: c.requestedResolution,
        requestedAmountMinor: c.requestedAmountMinor,
        approvedAmountMinor: c.approvedAmountMinor,
        refundedAmountMinor: c.refundedAmountMinor,
        riskLevel: c.riskLevel,
        riskScore: c.riskScore,
        assignedLabel: c.assignedLabel,
        escalated: Boolean(c.escalatedAt),
        pendingApproval: Boolean(c.pendingApproval),
        customerDeadlineAt: c.customerDeadlineAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.create')
  if (!gate.ok) return gate.response
  const parsed = createCaseSchema.safeParse((await readJsonObject(request)) ?? {})
  if (!parsed.success) return NextResponse.json({ error: 'Некорректная заявка' }, { status: 400 })
  if (parsed.data.photos.length > 0) return NextResponse.json({ error: 'Файлы прикладываются к заявке после создания' }, { status: 400 })
  const result = await createCase({ ...parsed.data, photos: [], actor: gate.actor })
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status })
  return NextResponse.json({ id: result.case.id, caseNumber: result.case.caseNumber, created: result.created }, { status: result.created ? 201 : 200 })
}
