// Newsletter sign-ups (public.newsletter_subscribers, migration 0034). The
// only writer, used by /api/newsletter.
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Locale } from '@/lib/types'
import { isValidEmail } from '@/lib/validation'

export type NewsletterError = 'INVALID_EMAIL' | 'UNAVAILABLE' | 'FAILED'
export type NewsletterOutcome = { ok: true; already: boolean } | { ok: false; error: NewsletterError }

const LOCALES: Locale[] = ['ru', 'en', 'it', 'fr', 'de']

// Postgres "undefined table" and PostgREST "not in the schema cache": the
// migration has not been applied yet. Reported as UNAVAILABLE so the form can
// say "try later" instead of pretending the address was saved.
const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

/**
 * Subscribes an address. Signing up again is not an error: an address that is
 * already on the list (and has not opted out) comes back as `already`, and one
 * that had opted out is subscribed again with a fresh consent time.
 */
export async function subscribeToNewsletter(input: {
  email: string
  locale?: string
  source?: string
  userId?: string
}): Promise<NewsletterOutcome> {
  const email = input.email.trim().toLowerCase()
  if (!isValidEmail(email) || email.length > 254) return { ok: false, error: 'INVALID_EMAIL' }

  const locale = LOCALES.indexOf(input.locale as Locale) !== -1 ? (input.locale as Locale) : 'ru'
  const source = (input.source ?? 'contact').slice(0, 40)
  const supabase = createAdminClient()

  const { data: existing, error: readError } = await supabase
    .from('newsletter_subscribers')
    .select('id, unsubscribed_at')
    .eq('email', email)
    .maybeSingle()
  if (readError) {
    if (MISSING_TABLE.has(readError.code)) return { ok: false, error: 'UNAVAILABLE' }
    console.error('[newsletter] lookup failed:', readError.message)
    return { ok: false, error: 'FAILED' }
  }

  if (existing && !existing.unsubscribed_at) return { ok: true, already: true }

  if (existing) {
    const { error } = await supabase
      .from('newsletter_subscribers')
      .update({ unsubscribed_at: null, consented_at: new Date().toISOString(), locale, source })
      .eq('id', existing.id)
    if (error) {
      console.error('[newsletter] resubscribe failed:', error.message)
      return { ok: false, error: 'FAILED' }
    }
    return { ok: true, already: false }
  }

  const { error } = await supabase
    .from('newsletter_subscribers')
    .insert({ email, locale, source, user_id: input.userId ?? null })
  if (error) {
    // Two submissions racing: the unique index caught the second one.
    if (error.code === '23505') return { ok: true, already: true }
    if (MISSING_TABLE.has(error.code)) return { ok: false, error: 'UNAVAILABLE' }
    console.error('[newsletter] insert failed:', error.message)
    return { ok: false, error: 'FAILED' }
  }
  return { ok: true, already: false }
}
