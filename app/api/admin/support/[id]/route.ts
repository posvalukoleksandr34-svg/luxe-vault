import { NextResponse, type NextRequest } from 'next/server'
import { deleteTicket, findTicketById, markRead, setTicketStatus, staffView, ticketDetail } from '@/lib/server/support-store'
import { SUPPORT_TICKET_STATUSES, type SupportTicketStatus } from '@/lib/types'
import { requireAdmin } from '@/lib/server/admin-guard'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

// Auth is already enforced by middleware.ts for every /api/admin/* path.

/** The conversation. Opening it marks the customer's messages as read. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const row = await findTicketById(params.id)
    if (!row) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    const ticket = await ticketDetail(row, 'staff')
    await markRead(row, 'staff')
    return NextResponse.json({ ticket: { ...ticket, unread: false } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to read ticket'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const body = await readJsonObject<{ status?: string }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.status || (SUPPORT_TICKET_STATUSES as string[]).indexOf(body.status) === -1) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updated = await setTicketStatus(params.id, body.status as SupportTicketStatus)
  if (!updated) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  return NextResponse.json({ ticket: staffView(updated) })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const removed = await deleteTicket(params.id)
  if (!removed) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
