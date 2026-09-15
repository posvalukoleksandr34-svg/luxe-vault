import { NextResponse, type NextRequest } from 'next/server'
import { emailLang } from '@/lib/server/emails/copy'
import { isMailConfigured, sendTicketReceived, sendTicketToSupportInbox } from '@/lib/server/mailer'
import { enforceLimit } from '@/lib/server/rate-limit'
import {
  EMAIL_RE,
  FIELD_LIMITS,
  category,
  clip,
  inputError,
  nameOf,
  orderNumber,
  readSupportForm,
} from '@/lib/server/support-input'
import { createTicket } from '@/lib/server/support-store'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Files a support request: category, subject, message, optionally an order
 * and up to four photos or PDFs (multipart).
 *
 * A signed-in customer's ticket belongs to their account. A guest gives a
 * reply address and gets the ticket's access token back — kept on this device
 * for "My tickets", and in the emailed link — which is the only key to the
 * conversation for someone without an account.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('support.create', request)
  if (limited) return limited

  const form = await readSupportForm(request)
  if (form instanceof NextResponse) return form
  const { fields, files } = form

  let user: Awaited<ReturnType<typeof getCurrentUser>> = null
  try {
    user = await getCurrentUser()
  } catch {
    // No session or auth unreachable: the request is filed as a guest's.
  }

  const subject = clip(fields.subject, FIELD_LIMITS.subject)
  const body = clip(fields.message, FIELD_LIMITS.body)
  const email = user?.email ?? clip(fields.email, FIELD_LIMITS.email)
  const name = user ? nameOf(user) : clip(fields.name, FIELD_LIMITS.name) || email.split('@')[0]

  const missing = [!subject && 'subject', !body && 'message', !email && 'email'].filter(Boolean)
  if (missing.length) {
    return NextResponse.json({ error: `Missing required field(s): ${missing.join(', ')}` }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  const lang = emailLang(fields.locale)
  try {
    const { row, ticket } = await createTicket({
      userId: user?.id,
      name,
      email,
      category: category(fields.category),
      subject,
      orderNumber: orderNumber(fields.orderNumber),
      locale: lang,
      body,
      files,
    })

    // The ticket is stored; a mail failure must not turn that into an error
    // (the customer would file it again).
    if (isMailConfigured) {
      const [toStaff, toCustomer] = await Promise.all([
        sendTicketToSupportInbox(ticket, body, 'new', files.length),
        sendTicketReceived(ticket, row.access_token, lang),
      ])
      if (!toStaff || !toCustomer) {
        console.warn(`[support] ${ticket.number} stored, email incomplete (staff=${toStaff}, customer=${toCustomer})`)
      }
    }

    return NextResponse.json({ ticket, token: row.access_token }, { status: 201 })
  } catch (e) {
    const bad = inputError(e)
    if (bad) return bad
    console.error('[support] failed to create ticket:', e)
    return NextResponse.json({ error: 'Could not save your request' }, { status: 500 })
  }
}
