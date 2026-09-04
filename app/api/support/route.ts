import { NextResponse, type NextRequest } from 'next/server'
import { addTicket } from '@/lib/server/support-store'
import type { SupportTicket } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_NAME_LENGTH = 60
const MAX_MESSAGE_LENGTH = 1000

function generateTicketId() {
  return `sup-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

// Public — anyone can open a support ticket. Only the admin-protected
// /api/admin/support can list or manage them afterward.
export async function POST(request: NextRequest) {
  let body: { name?: string; email?: string; message?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const name = body.name?.trim().slice(0, MAX_NAME_LENGTH)
  const email = body.email?.trim().slice(0, MAX_NAME_LENGTH)
  const message = body.message?.trim().slice(0, MAX_MESSAGE_LENGTH)

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'Malformed ticket' }, { status: 400 })
  }

  const ticket: SupportTicket = {
    id: generateTicketId(),
    name,
    email,
    message,
    createdAt: Date.now(),
    status: 'open',
  }

  await addTicket(ticket)
  return NextResponse.json({ ticket }, { status: 201 })
}
