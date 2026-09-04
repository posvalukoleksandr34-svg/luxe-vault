import { NextResponse, type NextRequest } from 'next/server'
import { deleteTicket, setTicketStatus } from '@/lib/server/support-store'
import type { SupportTicketStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: SupportTicketStatus[] = ['open', 'resolved']

// Auth is already enforced by middleware.ts for every /api/admin/* path.

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.status || !VALID_STATUSES.includes(body.status as SupportTicketStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updated = await setTicketStatus(params.id, body.status as SupportTicketStatus)
  if (!updated) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  return NextResponse.json({ ticket: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const removed = await deleteTicket(params.id)
  if (!removed) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
