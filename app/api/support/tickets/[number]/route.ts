import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'
import { findCustomerTicket, markRead, ticketDetail } from '@/lib/server/support-store'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * One ticket's conversation, for its customer: by session, or by the access
 * token from the email link / this device (`?t=`). Opening it clears the
 * unread mark. "Not found" covers a wrong token too, so numbers cannot be
 * probed.
 */
export async function GET(request: NextRequest, { params }: { params: { number: string } }) {
  const limited = await enforceLimit('support.read', request)
  if (limited) return limited

  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    userId = undefined
  }
  const token = request.nextUrl.searchParams.get('t') ?? undefined

  try {
    const row = await findCustomerTicket(params.number, { userId, token })
    if (!row) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    const ticket = await ticketDetail(row, 'customer')
    await markRead(row, 'customer')
    return NextResponse.json(
      { ticket: { ...ticket, unread: false }, token: row.access_token },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    console.error('[support] failed to read ticket:', e)
    return NextResponse.json({ error: 'Could not load this request' }, { status: 503 })
  }
}
