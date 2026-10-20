import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { STAFF_ERRORS, StaffChangeRefused, createStaff, listStaff, requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'


/** Staff accounts (staff.manage — the owner; the shared login while none exist). */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('staff.manage')
  if (!gate.ok) return gate.response
  return NextResponse.json({ staff: await listStaff() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('staff.manage')
  if (!gate.ok) return gate.response
  const body = (await readJsonObject<{ displayName?: unknown; role?: unknown; passphrase?: unknown }>(request)) ?? {}
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  if (displayName.length < 2 || displayName.length > 60) return NextResponse.json({ error: 'Имя — от 2 до 60 символов' }, { status: 400 })
  try {
    const member = await createStaff(
      { displayName, role: String(body.role ?? ''), passphrase: typeof body.passphrase === 'string' ? body.passphrase : '' },
      gate.actor,
    )
    return NextResponse.json({ staff: member }, { status: 201 })
  } catch (e) {
    if (e instanceof StaffChangeRefused) return NextResponse.json({ error: STAFF_ERRORS[e.code] ?? e.code }, { status: 400 })
    throw e
  }
}
