import { NextResponse, type NextRequest } from 'next/server'

import { staffActionSchema } from '@/lib/refunds/schemas'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObjectLimited } from '@/lib/server/http'
import { runStaffCommand } from '@/lib/server/refunds/workflow'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/**
 * Every staff action on a case: { command, version, ...input }.
 *
 * The console's buttons and a hand-written request get the same treatment:
 * the workflow (lib/server/refunds/workflow.ts) checks the command against
 * the state machine and the caller's role, the case version the decision was
 * made on (409 if someone changed it since), and the command's own rules —
 * amounts are computed on the server, never taken from here.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const denied = await requireAdmin()
  if (denied) return denied
  // Any role that can see a case may try; the workflow checks the command's
  // own permission and answers 403 for one the role does not carry.
  const gate = await requireStaff('case.view')
  if (!gate.ok) return gate.response
  const raw = await readJsonObjectLimited(request, 64 * 1024)
  if (raw === 'too_large') return NextResponse.json({ error: 'Слишком большой запрос' }, { status: 413 })
  const parsed = staffActionSchema.safeParse(raw ?? {})
  if (!parsed.success) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  const { command, version, ...input } = parsed.data
  const result = await runStaffCommand(id, command, input, gate.actor, version)
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code, payment: result.payment }, { status: result.status })
  }
  return NextResponse.json({ ok: true, version: result.case.version, state: result.case.state, payment: result.payment, message: result.message })
}
