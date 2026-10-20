import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { STAFF_ERRORS, StaffChangeRefused, requireStaff, updateStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/** A role, active flag or new passphrase for one staff member. */
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('staff.manage')
  if (!gate.ok) return gate.response
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 })
  const body = (await readJsonObject<{ role?: unknown; active?: unknown; passphrase?: unknown }>(request)) ?? {}
  try {
    const member = await updateStaff(
      id,
      {
        role: typeof body.role === 'string' ? body.role : undefined,
        active: typeof body.active === 'boolean' ? body.active : undefined,
        passphrase: typeof body.passphrase === 'string' ? body.passphrase : undefined,
      },
      gate.actor,
    )
    return NextResponse.json({ staff: member })
  } catch (e) {
    if (e instanceof StaffChangeRefused) {
      return NextResponse.json({ error: STAFF_ERRORS[e.code] ?? e.code }, { status: e.code === 'not_found' ? 404 : 400 })
    }
    throw e
  }
}
