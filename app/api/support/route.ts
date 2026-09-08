import { NextResponse, type NextRequest } from 'next/server'
import { enforceLimit } from '@/lib/server/rate-limit'
import {
  isMailConfigured,
  sendSupportConfirmation,
  sendSupportNotification,
} from '@/lib/server/mailer'
import { addTicket } from '@/lib/server/support-store'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const MAX_NAME_LENGTH = 60
const MAX_EMAIL_LENGTH = 254 // RFC 5321 maximum
const MAX_MESSAGE_LENGTH = 1000

// Deliberately permissive: this is a contact form, not an auth boundary.
// Rejecting an unusual-but-valid address is worse than accepting a junk one.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Public — anyone can open a support ticket. Only the admin-protected
// /api/admin/support can list or manage them afterward.
export async function POST(request: NextRequest) {
  const limited = await enforceLimit('support.create', request)
  if (limited) return limited

  let body: { name?: unknown; email?: unknown; message?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : ''

  const name = str(body.name, MAX_NAME_LENGTH)
  // Previously truncated to MAX_NAME_LENGTH (60) along with the name, which
  // silently corrupted any address longer than that into an unreplyable one.
  const email = str(body.email, MAX_EMAIL_LENGTH)
  const message = str(body.message, MAX_MESSAGE_LENGTH)

  // Report which field is wrong instead of one opaque "Malformed ticket", so
  // a customer whose message fails can actually tell what to change.
  const missing = [!name && 'name', !email && 'email', !message && 'message'].filter(
    Boolean,
  )
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missing.join(', ')}` },
      { status: 400 },
    )
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // Attach the sender when they happen to be signed in; anonymous is fine.
  let userId: string | undefined
  try {
    userId = (await getCurrentUser())?.id
  } catch {
    // No session or Supabase unreachable — the ticket is still worth storing.
  }

  try {
    const ticket = await addTicket(
      { id: '', name, email, message, createdAt: Date.now(), status: 'open' },
      userId,
    )

    // Fire both emails after the ticket is safely stored, and never let a mail
    // failure fail this request: the enquiry is already recorded and visible
    // in the admin console. Telling the customer their message failed at that
    // point would be a lie, and would invite a duplicate submission.
    let emailed = false
    if (isMailConfigured) {
      const enquiry = { id: ticket.id, name, email, message }
      const [toSupport, toCustomer] = await Promise.all([
        sendSupportNotification(enquiry),
        sendSupportConfirmation(enquiry),
      ])
      emailed = toSupport && toCustomer
      if (!emailed) {
        console.warn(
          `[support] ticket ${ticket.id} stored but email incomplete ` +
            `(support=${toSupport}, customer=${toCustomer})`,
        )
      }
    }

    return NextResponse.json({ ticket, emailed }, { status: 201 })
  } catch (e) {
    // Log the real cause server-side; the customer gets a generic message so a
    // database error never leaks schema details into the browser.
    console.error('[support] failed to store ticket:', e)
    return NextResponse.json({ error: 'Could not save your message' }, { status: 500 })
  }
}
