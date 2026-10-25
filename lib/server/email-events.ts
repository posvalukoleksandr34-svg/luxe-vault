import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Delivery events from Resend: hard bounces and spam complaints, so the shop
 * stops writing to addresses that cannot or do not want to receive its mail.
 *
 * Resend signs each webhook the Svix way: headers `svix-id`,
 * `svix-timestamp` and `svix-signature` ("v1,<base64>" entries, space
 * separated), the signature being HMAC-SHA256 over
 * `${id}.${timestamp}.${body}` with the endpoint's secret (`whsec_<base64>`,
 * RESEND_WEBHOOK_SECRET). A delivery more than five minutes old is refused,
 * so a captured one cannot be replayed later.
 *
 * What is done (app/api/email/webhook/route.ts):
 *   email.bounced     the server refused the address permanently → no more
 *                     optional mail to it (email_suppressions, "bounced")
 *                     and off the newsletter
 *   email.complained  the recipient marked a message as spam → the same,
 *                     recorded as "unsubscribed"
 * A temporary bounce (`bounce.type` "Transient") changes nothing; Resend
 * retries those itself. Order and payment emails are transactional and are
 * still sent: a customer must hear about their own order.
 */

export const WEBHOOK_TOLERANCE_S = 5 * 60

export function verifyResendSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_S) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  if (key.length === 0) return false
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  return signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',', 2)
    if (version !== 'v1' || !value) return false
    const got = Buffer.from(value, 'base64')
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
}

export type Suppression = { emails: string[]; reason: 'bounced' | 'unsubscribed' }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** What an event asks for, or null when it asks for nothing. Pure. */
export function suppressionFor(event: unknown): Suppression | null {
  if (!event || typeof event !== 'object') return null
  const { type, data } = event as { type?: unknown; data?: { to?: unknown; bounce?: { type?: unknown } } }
  let reason: Suppression['reason']
  if (type === 'email.bounced') {
    if (typeof data?.bounce?.type === 'string' && data.bounce.type.toLowerCase() === 'transient') return null
    reason = 'bounced'
  } else if (type === 'email.complained') {
    reason = 'unsubscribed'
  } else {
    return null
  }
  const raw = data?.to
  const to: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const emails = [...new Set(to.filter((e): e is string => typeof e === 'string').map((e) => e.trim().toLowerCase()))].filter(
    (e) => e.length >= 3 && e.length <= 254 && EMAIL.test(e),
  )
  return emails.length ? { emails, reason } : null
}

/**
 * Records a suppression. Idempotent: Resend may deliver an event more than
 * once, and an address already suppressed keeps its first reason.
 */
export async function applySuppression(s: Suppression): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('email_suppressions')
    .upsert(
      s.emails.map((email) => ({ email, kind: 'review_requests', reason: s.reason })),
      { onConflict: 'email,kind', ignoreDuplicates: true },
    )
  if (error) throw new Error(`suppression failed: ${error.message}`)

  // Off the newsletter as well: a hard bounce or a complaint on any mail is
  // a reason not to send marketing to that address again.
  const { error: nlError } = await admin
    .from('newsletter_subscribers')
    .update({ unsubscribed_at: new Date().toISOString() })
    .in('email', s.emails)
    .is('unsubscribed_at', null)
  if (nlError && !['42P01', 'PGRST205'].includes(nlError.code ?? '')) {
    throw new Error(`newsletter unsubscribe failed: ${nlError.message}`)
  }
}
