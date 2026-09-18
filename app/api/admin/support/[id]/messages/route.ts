import { NextResponse, type NextRequest } from 'next/server'
import { emailLang } from '@/lib/server/emails/copy'
import { isMailConfigured, sendSupportReply } from '@/lib/server/mailer'
import { FIELD_LIMITS, clip, inputError, readSupportForm } from '@/lib/server/support-input'
import { addMessage, customerView, findTicketById, ticketDetail } from '@/lib/server/support-store'
import { SUPPORT_TICKET_STATUSES, type SupportTicketStatus } from '@/lib/types'
import { requireAdmin } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

// Auth is already enforced by middleware.ts for every /api/admin/* path.

/**
 * Support answers in the thread (multipart: message, status, files). The
 * customer is emailed the reply with a link back to the conversation, and
 * sees the unread mark on the support button next time they visit.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const form = await readSupportForm(request)
  if (form instanceof NextResponse) return form
  const { fields, files } = form

  const body = clip(fields.message, FIELD_LIMITS.body)
  if (!body) return NextResponse.json({ error: 'Пустой ответ' }, { status: 400 })
  const status =
    (SUPPORT_TICKET_STATUSES as string[]).indexOf(fields.status ?? '') !== -1
      ? (fields.status as SupportTicketStatus)
      : undefined

  try {
    const row = await findTicketById(params.id)
    if (!row) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    await addMessage(row, 'staff', body, files, status)

    let emailed = false
    if (isMailConfigured) {
      emailed = await sendSupportReply(customerView(row), row.access_token, body, emailLang(row.locale))
      if (!emailed) console.warn(`[support] reply on ${row.ticket_number} saved but not emailed`)
    }

    const fresh = await findTicketById(params.id)
    const ticket = await ticketDetail(fresh ?? row, 'staff')
    return NextResponse.json({ ticket: { ...ticket, unread: false }, emailed }, { status: 201 })
  } catch (e) {
    const bad = inputError(e)
    if (bad) return bad
    const message = e instanceof Error ? e.message : 'Failed to send reply'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
