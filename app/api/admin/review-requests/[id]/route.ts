import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObjectLimited } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'
import { audit } from '@/lib/server/refunds/audit'
import { cancelRequest, retryRequest } from '@/lib/server/review-requests/admin'
import { requireStaff } from '@/lib/server/staff'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST { action: 'retry' | 'cancel' } on one request — manager and owner
 * (review_requests.manage). Retry puts a failed or cancelled request back in
 * the queue (the worker decides again whether it may go; nothing is sent from
 * here); cancel stops one that has not gone out.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const gate = await requireStaff('review_requests.manage')
  if (!gate.ok) return gate.response
  const limited = await enforceLimit('review_requests.action', request, `staff:${gate.actor.staffId ?? 'legacy'}`)
  if (limited) return limited
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  const body = await readJsonObjectLimited<{ action?: unknown }>(request, 1024)
  const action = body && body !== 'too_large' ? body.action : null
  if (action !== 'retry' && action !== 'cancel') return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  try {
    const result = action === 'retry' ? await retryRequest(id) : await cancelRequest(id)
    if (result !== 'ok') {
      return NextResponse.json(
        { error: action === 'retry' ? 'Повторить можно только неудачный или отменённый запрос' : 'Отменить можно только ещё не отправленный запрос' },
        { status: 409 },
      )
    }
    await audit({ actor: gate.actor, action: `review_request.${action}`, data: { review_request_id: id } }).catch((e) =>
      console.error('[admin/review-requests] audit failed:', (e as Error).message),
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(`[admin/review-requests] ${action} failed:`, (e as Error).message)
    return NextResponse.json({ error: 'Не удалось выполнить' }, { status: 500 })
  }
}
