import { NextResponse, type NextRequest } from 'next/server'
import { isToken, listSubscribers, setSubscriberStatus } from '@/lib/server/newsletter-campaigns'
import { emailMode } from '@/lib/server/resend'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/** The subscriber list with its counts, and the last campaigns. `gap` names a
 *  migration that has not been applied yet ('tables' → 0034, 'columns' → 0037). */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const result = await listSubscribers()
  if (!result.ok) {
    if (result.gap) return NextResponse.json({ gap: result.gap }, { status: 503 })
    return NextResponse.json({ error: 'Could not load subscribers' }, { status: 500 })
  }
  // `mode` so the composer can say plainly when a send will not reach anyone.
  return NextResponse.json({ ...result, mode: emailMode() }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Manually activate or deactivate one subscriber. */
export async function PATCH(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const body = await readJsonObject<{ id?: unknown; status?: unknown }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!isToken(body.id) || (body.status !== 'active' && body.status !== 'unsubscribed')) {
    return NextResponse.json({ error: 'Invalid subscriber or status' }, { status: 400 })
  }
  const ok = await setSubscriberStatus(body.id, body.status)
  return ok
    ? NextResponse.json({ ok: true, id: body.id, status: body.status })
    : NextResponse.json({ error: 'Could not update the subscriber' }, { status: 500 })
}
