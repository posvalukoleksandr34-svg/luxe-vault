import { NextResponse, type NextRequest } from 'next/server'

import { PERMISSIONS, can } from '@/lib/refunds/permissions'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'
import { securityEvent } from '@/lib/server/security-events'
import { actorFor, bindSession, listStaff, resolveStaffContext, unbindSession } from '@/lib/server/staff'
import { clientIp } from '@/lib/server/client-ip'
import { staffUnmigrated } from '@/lib/server/refunds/schema'

export const dynamic = 'force-dynamic'

/**
 * Who is using the console (lib/server/staff.ts).
 *
 *   GET     the session's staff identity, its role and permissions, and the
 *           active staff names to choose from;
 *   POST    "this is me": { staffId, passphrase } binds the session;
 *   DELETE  unbinds it (switch user).
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const unmigrated = await staffUnmigrated()
  if (unmigrated) return unmigrated
  const ctx = await resolveStaffContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = actorFor(ctx)
  const staff = ctx.mode === 'legacy' ? [] : (await listStaff()).filter((s) => s.active).map((s) => ({ id: s.id, name: s.displayName }))
  return NextResponse.json(
    {
      mode: ctx.mode,
      staff: ctx.mode === 'staff' ? { id: ctx.staff.id, name: ctx.staff.displayName, role: ctx.staff.role } : null,
      role: actor?.role ?? null,
      label: actor?.label ?? null,
      permissions: actor ? PERMISSIONS.filter((p) => can(actor.role, p)) : [],
      choices: staff,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const limited = await enforceLimit('admin.staff_bind', request)
  if (limited) return limited
  const ctx = await resolveStaffContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await readJsonObject<{ staffId?: unknown; passphrase?: unknown }>(request)) ?? {}
  const staffId = typeof body.staffId === 'string' && /^[0-9a-f-]{36}$/i.test(body.staffId) ? body.staffId : null
  const passphrase = typeof body.passphrase === 'string' ? body.passphrase : ''
  if (!staffId || !passphrase) return NextResponse.json({ error: 'Выберите сотрудника и введите пароль' }, { status: 400 })
  const result = await bindSession(ctx.nonce, staffId, passphrase)
  if (result === 'bound') return NextResponse.json({ ok: true })
  if (result === 'wrong') securityEvent('admin_staff_bind_failed', { ip: clientIp(request.headers) })
  const message =
    result === 'locked'
      ? 'Слишком много неверных попыток — учётная запись заблокирована на 15 минут'
      : result === 'unavailable'
        ? 'Сессия не найдена — войдите в админку заново'
        : 'Неверный сотрудник или пароль'
  return NextResponse.json({ error: message }, { status: result === 'locked' ? 423 : 401 })
}

export async function DELETE() {
  const denied = await requireAdmin()
  if (denied) return denied
  const ctx = await resolveStaffContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await unbindSession(ctx.nonce)
  return NextResponse.json({ ok: true })
}
