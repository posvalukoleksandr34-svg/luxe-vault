import 'server-only'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { can, type Permission } from '@/lib/refunds/permissions'
import { STAFF_ROLES, type Actor, type StaffRole } from '@/lib/refunds/types'
import { ADMIN_SESSION_COOKIE, verifySessionToken } from '@/lib/server/admin-auth'
import { sessionState } from '@/lib/server/admin-sessions'
import { audit } from '@/lib/server/refunds/audit'
import { hashPassphrase, passphraseProblem, verifyPassphrase } from '@/lib/server/staff-password'
import { createAdminClient } from '@/lib/supabase/admin'
import { staffUnmigrated } from '@/lib/server/refunds/schema'

/**
 * WHO is using the admin console (migration 0059, admin_staff).
 *
 * The console has one shared login: a password and a TOTP code
 * (app/api/admin/login). That proves "someone allowed in", not "who", and a
 * refund decision needs a who — for the audit trail, for roles, and so that a
 * second approval can be required to come from a DIFFERENT person.
 *
 * So staff identities sit ON TOP of that login. After signing in, a staff
 * member picks their name and enters their own passphrase; the console
 * session (admin_sessions) is then bound to them until it ends or they switch.
 *
 * LEGACY MODE. A shop that has not created any staff yet — today's single
 * operator — keeps working: with no active owner on record, the shared login
 * acts as the owner, labelled as the shared login in every audit row. Creating
 * the first owner ends legacy mode for good (the last active owner cannot be
 * removed or demoted). Features that need two different people — a second
 * approval — are unavailable in legacy mode and say so.
 *
 * Only the refund system reads roles today; the rest of the console is still
 * gated by the shared login alone (requireAdmin), unchanged.
 */

export type StaffMember = {
  id: string
  displayName: string
  role: StaffRole
  active: boolean
  lockedUntil?: number
  lastSignedInAt?: number
  createdAt: number
}

export type StaffContext =
  | { mode: 'legacy'; nonce: string }
  | { mode: 'staff'; nonce: string; staff: StaffMember }
  | { mode: 'unbound'; nonce: string }

export const LEGACY_LABEL = 'Администратор (общий вход)'
const MAX_FAILED = 5
const LOCK_MINUTES = 15

const SELECT = 'id, display_name, role, active, locked_until, last_signed_in_at, created_at'

function toStaff(row: Record<string, unknown>): StaffMember {
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    role: row.role as StaffRole,
    active: Boolean(row.active),
    lockedUntil: row.locked_until ? Date.parse(row.locked_until as string) : undefined,
    lastSignedInAt: row.last_signed_in_at ? Date.parse(row.last_signed_in_at as string) : undefined,
    createdAt: Date.parse(row.created_at as string),
  }
}

/** True once any active owner exists — the end of legacy mode. */
export async function hasActiveOwner(): Promise<boolean> {
  const { count, error } = await createAdminClient()
    .from('admin_staff')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'owner')
    .eq('active', true)
  if (error) throw new Error(`Failed to read staff: ${error.message}`)
  return (count ?? 0) > 0
}

/** The signed-in console session's nonce, or null when this is not one. */
async function adminNonce(): Promise<string | null> {
  try {
    const session = await verifySessionToken((await cookies()).get(ADMIN_SESSION_COOKIE)?.value)
    if (!session) return null
    const state = await sessionState(session.nonce)
    // 'unmigrated' (no admin_sessions table) cannot be bound to anyone, but
    // it IS a valid console session: requireAdmin accepts it too.
    return state === 'active' || state === 'unmigrated' ? session.nonce : null
  } catch {
    return null
  }
}

/** Who this console request is, or null when it is not a console request. */
export async function resolveStaffContext(): Promise<StaffContext | null> {
  const nonce = await adminNonce()
  if (!nonce) return null
  if (!(await hasActiveOwner())) return { mode: 'legacy', nonce }

  const { data, error } = await createAdminClient()
    .from('admin_sessions')
    .select(`staff_id, admin_staff(${SELECT})`)
    .eq('nonce', nonce)
    .maybeSingle()
  if (error) throw new Error(`Failed to read the session's staff binding: ${error.message}`)
  const joined = (data as { admin_staff?: Record<string, unknown> | Record<string, unknown>[] | null } | null)?.admin_staff
  const row = Array.isArray(joined) ? joined[0] : joined
  if (!row) return { mode: 'unbound', nonce }
  const staff = toStaff(row)
  // Deactivated since binding: the binding dies with the account.
  if (!staff.active) return { mode: 'unbound', nonce }
  return { mode: 'staff', nonce, staff }
}

export function actorFor(ctx: StaffContext): Extract<Actor, { type: 'staff' }> | null {
  if (ctx.mode === 'legacy') return { type: 'staff', staffId: null, role: 'owner', label: LEGACY_LABEL, legacy: true }
  if (ctx.mode === 'staff') {
    return { type: 'staff', staffId: ctx.staff.id, role: ctx.staff.role, label: ctx.staff.displayName, legacy: false }
  }
  return null
}

export type StaffGate =
  | { ok: true; actor: Extract<Actor, { type: 'staff' }>; ctx: StaffContext }
  | { ok: false; response: NextResponse }

/**
 * For refund routes: `const gate = await requireStaff('case.decide'); if (!gate.ok) return gate.response`.
 *
 *   401  not a console session at all (the same body requireAdmin sends);
 *   403  STAFF_REQUIRED — staff exist and this session has not said who it is;
 *   403  FORBIDDEN — the role does not carry the permission.
 */
export async function requireStaff(permission: Permission): Promise<StaffGate> {
  let ctx: StaffContext | null
  try {
    const unmigrated = await staffUnmigrated()
    if (unmigrated) return { ok: false, response: unmigrated }
    ctx = await resolveStaffContext()
  } catch (e) {
    console.error('[staff] could not resolve the console user:', (e as Error).message)
    return { ok: false, response: NextResponse.json({ error: 'Временно недоступно' }, { status: 503 }) }
  }
  if (!ctx) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const actor = actorFor(ctx)
  if (!actor) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'STAFF_REQUIRED', message: 'Выберите сотрудника и введите личный пароль' }, { status: 403 }),
    }
  }
  if (!can(actor.role, permission)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'FORBIDDEN', message: 'Недостаточно прав для этого действия' }, { status: 403 }),
    }
  }
  return { ok: true, actor, ctx }
}

// ------------------------------------------------------------------ binding

export type BindResult = 'bound' | 'wrong' | 'locked' | 'unavailable'

/**
 * "This is me": checks a staff member's passphrase and binds the console
 * session to them. Five wrong passphrases lock the ACCOUNT for 15 minutes
 * (the route also rate-limits by address, failing closed). A wrong name and a
 * wrong passphrase answer the same.
 */
export async function bindSession(nonce: string, staffId: string, passphrase: string): Promise<BindResult> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('admin_staff')
    .select('id, display_name, role, active, passphrase_hash, failed_attempts, locked_until')
    .eq('id', staffId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read staff: ${error.message}`)
  // Hash anyway on an unknown id, so its answer takes as long as a wrong passphrase.
  if (!data || !data.active) {
    await verifyPassphrase(passphrase, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    return 'wrong'
  }
  if (data.locked_until && Date.parse(data.locked_until as string) > Date.now()) return 'locked'

  if (!(await verifyPassphrase(passphrase, data.passphrase_hash as string))) {
    const failures = Number(data.failed_attempts) + 1
    await admin
      .from('admin_staff')
      .update({
        failed_attempts: failures >= MAX_FAILED ? 0 : failures,
        locked_until: failures >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
      })
      .eq('id', staffId)
    await audit({
      actor: { type: 'system', label: 'console' },
      action: failures >= MAX_FAILED ? 'staff.locked' : 'staff.sign_in_failed',
      data: { staffId },
    })
    return failures >= MAX_FAILED ? 'locked' : 'wrong'
  }

  const now = new Date().toISOString()
  const { data: bound, error: bindError } = await admin
    .from('admin_sessions')
    .update({ staff_id: staffId, staff_bound_at: now })
    .eq('nonce', nonce)
    .is('revoked_at', null)
    .select('nonce')
    .maybeSingle()
  if (bindError) throw new Error(`Failed to bind the session: ${bindError.message}`)
  if (!bound) return 'unavailable'
  await admin.from('admin_staff').update({ failed_attempts: 0, locked_until: null, last_signed_in_at: now }).eq('id', staffId)
  await audit({
    actor: { type: 'staff', staffId, role: data.role as StaffRole, label: data.display_name as string, legacy: false },
    action: 'staff.signed_in',
  })
  return 'bound'
}

export async function unbindSession(nonce: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('admin_sessions')
    .update({ staff_id: null, staff_bound_at: null })
    .eq('nonce', nonce)
  if (error) throw new Error(`Failed to unbind the session: ${error.message}`)
}

// --------------------------------------------------------------- management

export async function listStaff(): Promise<StaffMember[]> {
  const { data, error } = await createAdminClient()
    .from('admin_staff')
    .select(SELECT)
    .order('active', { ascending: false })
    .order('display_name')
  if (error) throw new Error(`Failed to list staff: ${error.message}`)
  return (data ?? []).map((row) => toStaff(row as Record<string, unknown>))
}

export type StaffChangeError = 'name_taken' | 'weak_passphrase' | 'last_owner' | 'not_found' | 'first_must_be_owner' | 'invalid_role' | 'self'

/** What the console says for each refusal (Russian, like the rest of it). */
export const STAFF_ERRORS: Record<StaffChangeError, string> = {
  name_taken: 'Сотрудник с таким именем уже есть',
  weak_passphrase: 'Пароль — от 12 символов',
  last_owner: 'Нельзя оставить магазин без владельца',
  not_found: 'Сотрудник не найден',
  first_must_be_owner: 'Первая учётная запись — владелец (owner)',
  invalid_role: 'Неизвестная роль',
  self: 'Нельзя отключить самого себя',
}

export class StaffChangeRefused extends Error {
  readonly code: StaffChangeError
  constructor(code: StaffChangeError) {
    super(code)
    this.code = code
  }
}

function isRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)
}

/**
 * Adds a staff member. In legacy mode the first one must be an OWNER — the
 * shared login is handing its powers to a named person, not adding a junior
 * beside itself.
 */
export async function createStaff(
  input: { displayName: string; role: string; passphrase: string },
  by: Extract<Actor, { type: 'staff' }>,
): Promise<StaffMember> {
  if (!isRole(input.role)) throw new StaffChangeRefused('invalid_role')
  if (passphraseProblem(input.passphrase)) throw new StaffChangeRefused('weak_passphrase')
  if (by.legacy && input.role !== 'owner') throw new StaffChangeRefused('first_must_be_owner')
  const { data, error } = await createAdminClient()
    .from('admin_staff')
    .insert({
      display_name: input.displayName.trim(),
      role: input.role,
      passphrase_hash: await hashPassphrase(input.passphrase),
      created_by: by.staffId,
    })
    .select(SELECT)
    .single()
  if (error) {
    if (error.code === '23505') throw new StaffChangeRefused('name_taken')
    throw new Error(`Failed to create staff: ${error.message}`)
  }
  const member = toStaff(data as Record<string, unknown>)
  await audit({ actor: by, action: 'staff.created', data: { staffId: member.id, name: member.displayName, role: member.role } })
  return member
}

async function activeOwnerCount(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('admin_staff')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'owner')
    .eq('active', true)
  if (error) throw new Error(`Failed to read staff: ${error.message}`)
  return count ?? 0
}

/** Role, active flag, or a new passphrase. Never leaves the shop without an owner. */
export async function updateStaff(
  id: string,
  change: { role?: string; active?: boolean; passphrase?: string },
  by: Extract<Actor, { type: 'staff' }>,
): Promise<StaffMember> {
  const admin = createAdminClient()
  const { data: current, error } = await admin.from('admin_staff').select(SELECT).eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to read staff: ${error.message}`)
  if (!current) throw new StaffChangeRefused('not_found')
  const before = toStaff(current as Record<string, unknown>)

  const patch: Record<string, unknown> = {}
  if (change.role !== undefined) {
    if (!isRole(change.role)) throw new StaffChangeRefused('invalid_role')
    patch.role = change.role
  }
  if (change.active !== undefined) {
    patch.active = change.active
    patch.deactivated_at = change.active ? null : new Date().toISOString()
  }
  if (change.passphrase !== undefined) {
    if (passphraseProblem(change.passphrase)) throw new StaffChangeRefused('weak_passphrase')
    patch.passphrase_hash = await hashPassphrase(change.passphrase)
    patch.failed_attempts = 0
    patch.locked_until = null
  }
  const losesOwner =
    before.role === 'owner' && before.active && ((patch.role && patch.role !== 'owner') || patch.active === false)
  if (losesOwner && (await activeOwnerCount()) <= 1) throw new StaffChangeRefused('last_owner')
  if (by.staffId === id && patch.active === false) throw new StaffChangeRefused('self')

  const { data, error: updateError } = await admin.from('admin_staff').update(patch).eq('id', id).select(SELECT).single()
  if (updateError) throw new Error(`Failed to update staff: ${updateError.message}`)
  // A deactivated or demoted member's open console sessions lose their binding.
  if (patch.active === false || patch.role !== undefined || patch.passphrase_hash) {
    await admin.from('admin_sessions').update({ staff_id: null, staff_bound_at: null }).eq('staff_id', id)
  }
  const after = toStaff(data as Record<string, unknown>)
  await audit({
    actor: by,
    action: 'staff.updated',
    data: {
      staffId: id,
      ...(patch.role !== undefined ? { role: [before.role, after.role] } : {}),
      ...(patch.active !== undefined ? { active: [before.active, after.active] } : {}),
      ...(patch.passphrase_hash ? { passphraseReset: true } : {}),
    },
  })
  return after
}
