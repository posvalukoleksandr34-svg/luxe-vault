import { NextResponse, type NextRequest } from 'next/server'
import { isMailConfigured, sendTicketToSupportInbox } from '@/lib/server/mailer'
import { enforceLimit } from '@/lib/server/rate-limit'
import { FIELD_LIMITS, clip, inputError, readSupportForm } from '@/lib/server/support-input'
import { addMessage, customerView, findCustomerTicket } from '@/lib/server/support-store'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** The customer's reply inside their ticket (multipart: message, t, files). */
export async function POST(request: NextRequest, { params }: { params: { number: string } }) {
  const limited = await enforceLimit('support.reply', request)
  if (limited) return limited

  const form = await readSupportForm(request)
  if (form instanceof NextResponse) return form
  const { fields, files } = form

  const body = clip(fields.message, FIELD_LIMITS.body)
  if (!body) return NextResponse.json({ error: 'Missing required field(s): message' }, { status: 400 })

  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    userId = undefined
  }

  try {
    const row = await findCustomerTicket(params.number, { userId, token: fields.t })
    if (!row) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    if (row.status === 'closed') {
      return NextResponse.json({ error: 'closed' }, { status: 409 })
    }
    const message = await addMessage(row, 'customer', body, files)
    if (isMailConfigured) await sendTicketToSupportInbox(customerView(row), body, 'reply', files.length)
    return NextResponse.json({ message, status: row.status }, { status: 201 })
  } catch (e) {
    const bad = inputError(e)
    if (bad) return bad
    console.error('[support] failed to add reply:', e)
    return NextResponse.json({ error: 'Could not send your message' }, { status: 500 })
  }
}
