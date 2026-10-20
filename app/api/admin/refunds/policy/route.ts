import { NextResponse, type NextRequest } from 'next/server'

import { DEFAULT_POLICY } from '@/lib/refunds/policy'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObjectLimited } from '@/lib/server/http'
import { activePolicy, policyHistory, savePolicy } from '@/lib/server/refunds/policy-store'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/**
 * GET  the policy in force, its history, and the built-in defaults;
 * PUT  a new version ({ config, basedOn, note }) — policy.manage only. Saved
 *      as a new row: cases keep the version they were judged under.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('case.view')
  if (!gate.ok) return gate.response
  const [current, history] = await Promise.all([activePolicy(), policyHistory()])
  return NextResponse.json({ ...current, history, defaults: DEFAULT_POLICY }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('policy.manage')
  if (!gate.ok) return gate.response
  const body = await readJsonObjectLimited<{ config?: unknown; basedOn?: unknown; note?: unknown }>(request, 64 * 1024)
  if (body === 'too_large') return NextResponse.json({ error: 'Слишком большой запрос' }, { status: 413 })
  if (!body || typeof body.basedOn !== 'number') return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  const result = await savePolicy(body.config, { basedOn: body.basedOn, note: typeof body.note === 'string' ? body.note : undefined }, gate.actor)
  if (!result.ok) {
    return result.reason === 'stale'
      ? NextResponse.json({ error: 'Политику уже изменили — обновите страницу' }, { status: 409 })
      : NextResponse.json({ error: 'Некорректные значения', issues: result.issues }, { status: 400 })
  }
  return NextResponse.json({ version: result.version })
}
