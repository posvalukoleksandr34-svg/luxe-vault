import { NextResponse, type NextRequest } from 'next/server'
import { emailLang } from '@/lib/server/emails/copy'
import { isMailConfigured, sendTicketReceived, sendTicketToSupportInbox } from '@/lib/server/mailer'
import { enforceLimit } from '@/lib/server/rate-limit'
import { EMAIL_RE, FIELD_LIMITS, clip } from '@/lib/server/support-input'
import { createTicket } from '@/lib/server/support-store'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * The original contact form: name, email, message. Kept so anything still
 * posting here (an open tab from before the support center, a saved form)
 * keeps working — the message becomes an ordinary ticket in the "other"
 * category. The support center itself posts to /api/support/tickets.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('support.create', request)
  if (limited) return limited

  let body: { name?: unknown; email?: unknown; message?: unknown; locale?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const str = (v: unknown, max: number) => clip(typeof v === 'string' ? v : '', max)

  const name = str(body.name, FIELD_LIMITS.name)
  const email = str(body.email, FIELD_LIMITS.email)
  const message = str(body.message, FIELD_LIMITS.body)

  const missing = [!name && 'name', !email && 'email', !message && 'message'].filter(Boolean)
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing required field(s): ${missing.join(', ')}` }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    // Anonymous is fine.
  }

  const lang = emailLang(body.locale)
  try {
    const { row, ticket } = await createTicket({
      userId,
      name,
      email,
      category: 'other',
      subject: message.split(/\r?\n/)[0].slice(0, 80),
      locale: lang,
      body: message,
      files: [],
    })
    let emailed = false
    if (isMailConfigured) {
      const [toStaff, toCustomer] = await Promise.all([
        sendTicketToSupportInbox(ticket, message, 'new'),
        sendTicketReceived(ticket, row.access_token, lang),
      ])
      emailed = toStaff && toCustomer
    }
    return NextResponse.json({ ticket, token: row.access_token, emailed }, { status: 201 })
  } catch (e) {
    console.error('[support] failed to store ticket:', e)
    return NextResponse.json({ error: 'Could not save your message' }, { status: 500 })
  }
}
