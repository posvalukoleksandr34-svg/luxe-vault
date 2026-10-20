import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { getCase } from '@/lib/server/refunds/cases'
import { staffCaseDetail } from '@/lib/server/refunds/staff-view'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/** One case, everything staff may see of it (lib/server/refunds/staff-view.ts). */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.view')
  if (!gate.ok) return gate.response
  const c = await getCase(id)
  if (!c) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  return NextResponse.json(await staffCaseDetail(c, gate.actor), { headers: { 'Cache-Control': 'no-store' } })
}
