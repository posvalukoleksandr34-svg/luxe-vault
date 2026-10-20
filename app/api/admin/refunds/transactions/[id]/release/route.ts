import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'
import { releaseStuckRefund } from '@/lib/server/refunds/workflow'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

/**
 * Releases a refund whose outcome stayed unknown — ONLY after Stripe confirms
 * it holds no refund for it (lib/server/refunds/payments.ts). If Stripe does
 * have one, it is recorded instead. A reason is required and audited.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('refund.execute')
  if (!gate.ok) return gate.response
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  const body = (await readJsonObject<{ reason?: unknown }>(request)) ?? {}
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 5) return NextResponse.json({ error: 'Укажите причину' }, { status: 400 })
  const result = await releaseStuckRefund(id, gate.actor, reason)
  if (!result.ok && result.code !== 'released') {
    return NextResponse.json({ error: result.message, code: result.code, payment: result.payment }, { status: result.status })
  }
  return NextResponse.json({ ok: true, payment: result.payment })
}
