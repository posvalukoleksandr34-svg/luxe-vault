import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'
import { listByTokens, listForUser } from '@/lib/server/support-store'
import { getCurrentUser } from '@/lib/supabase/server'
import type { SupportTicket } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * "My tickets", and the unread badge on the support button.
 *
 * The signed-in account's tickets, plus any this device filed as a guest —
 * each proven by the access token the browser kept when it was created (POST,
 * so tokens never sit in a URL or a log).
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('support.mine', request)
  if (limited) return limited

  let refs: { number: string; token: string }[] = []
  try {
    const body = (await request.json()) as { refs?: unknown }
    if (Array.isArray(body.refs)) refs = body.refs as { number: string; token: string }[]
  } catch {
    // An empty body is a signed-in customer asking for their own.
  }

  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    userId = undefined
  }

  try {
    const [own, guest] = await Promise.all([userId ? listForUser(userId) : [], listByTokens(refs)])
    const byId = new Map<string, SupportTicket>()
    for (const t of [...own, ...guest]) byId.set(t.id, t)
    const tickets = Array.from(byId.values()).sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    return NextResponse.json(
      { tickets, unread: tickets.filter((t) => t.unread).length, signedIn: Boolean(userId) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    console.error('[support] failed to list tickets:', e)
    return NextResponse.json({ error: 'Could not load your requests' }, { status: 503 })
  }
}
