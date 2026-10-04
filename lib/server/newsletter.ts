// Newsletter sign-ups (public.newsletter_subscribers, migration 0034). The
// only writer, used by /api/newsletter.
import 'server-only'

import { toStorefrontLocale } from '@/lib/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmail } from '@/lib/validation'
import { newsletterConfirmEmail } from '@/lib/server/emails/newsletter-confirm'
import { NEWSLETTER_FROM_ADDRESS, sendEmail } from '@/lib/server/resend'

export type NewsletterError = 'INVALID_EMAIL' | 'UNAVAILABLE' | 'FAILED'
export type NewsletterOutcome = { ok: true; already: boolean } | { ok: false; error: NewsletterError }

// Postgres "undefined table" and PostgREST "not in the schema cache": the
// migration has not been applied yet. Reported as UNAVAILABLE so the form can
// say "try later" instead of pretending the address was saved.
const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

/** A pending sign-up's confirmation is re-sent at most this often. */
const RESEND_AFTER_MS = 10 * 60 * 1000
/** Unconfirmed sign-ups older than this are deleted (migration 0051). */
const PENDING_TTL_DAYS = 30
// Postgres check_violation: status 'pending' does not exist yet — migration
// 0051 is not applied. Sign-ups are refused rather than added unconfirmed.
const PENDING_NOT_ALLOWED = '23514'

/**
 * Starts a subscription — double opt-in (migration 0051).
 *
 * A new address, or one that had unsubscribed, becomes `pending` and is sent
 * one email with a confirmation link; nothing else is ever sent to it until
 * the link is used (confirmNewsletter). An address already on the list, or
 * pending with a recent email, gets nothing — and the caller is told the same
 * thing in every case ("check your inbox"), so the form does not reveal who
 * is subscribed.
 */
export async function subscribeToNewsletter(input: {
  email: string
  locale?: string
  source?: string
  userId?: string
}): Promise<NewsletterOutcome> {
  const email = input.email.trim().toLowerCase()
  if (!isValidEmail(email) || email.length > 254) return { ok: false, error: 'INVALID_EMAIL' }

  // Storefront languages only: a subscriber can no longer be signed up in
  // Russian, and anything unrecognised becomes the storefront's default.
  const locale = toStorefrontLocale(input.locale)
  const source = (input.source ?? 'contact').slice(0, 40)
  const supabase = createAdminClient()

  // Housekeeping: confirmations nobody used. Best effort.
  void supabase
    .from('newsletter_subscribers')
    .delete()
    .eq('status', 'pending')
    .lt('confirmation_sent_at', new Date(Date.now() - PENDING_TTL_DAYS * 86_400_000).toISOString())
    .then(({ error }) => {
      if (error && !MISSING_TABLE.has(error.code)) console.warn('[newsletter] pending cleanup skipped:', error.message)
    })

  const { data: existing, error: readError } = await supabase
    .from('newsletter_subscribers')
    .select('id, status, unsubscribe_token, confirmation_sent_at')
    .eq('email', email)
    .maybeSingle()
  if (readError) {
    if (MISSING_TABLE.has(readError.code) || readError.code === '42703') return { ok: false, error: 'UNAVAILABLE' }
    console.error('[newsletter] lookup failed:', readError.message)
    return { ok: false, error: 'FAILED' }
  }

  if (existing?.status === 'active') return { ok: true, already: true }

  const now = new Date().toISOString()
  let token: string
  if (existing) {
    const recent =
      existing.status === 'pending' &&
      existing.confirmation_sent_at &&
      Date.now() - new Date(existing.confirmation_sent_at as string).getTime() < RESEND_AFTER_MS
    if (recent) return { ok: true, already: false }
    const { error } = await supabase
      .from('newsletter_subscribers')
      .update({ status: 'pending', consented_at: now, confirmation_sent_at: now, locale, source })
      .eq('id', existing.id)
    if (error) {
      if (error.code === PENDING_NOT_ALLOWED) return pendingUnavailable()
      console.error('[newsletter] re-subscribe failed:', error.message)
      return { ok: false, error: 'FAILED' }
    }
    token = existing.unsubscribe_token as string
  } else {
    const { data, error } = await supabase
      .from('newsletter_subscribers')
      .insert({ email, locale, source, user_id: input.userId ?? null, status: 'pending', confirmation_sent_at: now })
      .select('unsubscribe_token')
      .single()
    if (error) {
      // Two submissions racing: the unique index caught the second one.
      if (error.code === '23505') return { ok: true, already: false }
      if (error.code === PENDING_NOT_ALLOWED) return pendingUnavailable()
      if (MISSING_TABLE.has(error.code)) return { ok: false, error: 'UNAVAILABLE' }
      console.error('[newsletter] insert failed:', error.message)
      return { ok: false, error: 'FAILED' }
    }
    token = data.unsubscribe_token as string
  }

  const mail = newsletterConfirmEmail(token, locale)
  const sent = await sendEmail({ to: email, from: NEWSLETTER_FROM_ADDRESS, ...mail })
  if (!sent.ok) {
    console.error('[newsletter] confirmation email not sent:', sent.message)
    return { ok: false, error: 'FAILED' }
  }
  return { ok: true, already: false }
}

function pendingUnavailable(): NewsletterOutcome {
  console.error('[newsletter] sign-up refused: apply migration 0051 (double opt-in).')
  return { ok: false, error: 'UNAVAILABLE' }
}

/**
 * The confirmation link was used: the subscription starts now. Also accepts
 * an address that is already active (a second click), so the page can say
 * "confirmed" either way. An unsubscribed address is not reactivated here —
 * that is the unsubscribe page's "resubscribe", from its own link.
 */
export async function confirmNewsletter(token: string): Promise<'ok' | 'not_found' | 'failed'> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return 'not_found'
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('newsletter_subscribers')
    .update({ status: 'active', confirmed_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .eq('status', 'pending')
    .select('id')
  if (error) {
    console.error('[newsletter] confirm failed:', error.message)
    return 'failed'
  }
  if ((data ?? []).length === 1) return 'ok'
  const { data: row } = await supabase
    .from('newsletter_subscribers')
    .select('status')
    .eq('unsubscribe_token', token)
    .maybeSingle()
  return row?.status === 'active' ? 'ok' : 'not_found'
}
