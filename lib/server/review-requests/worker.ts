import 'server-only'

import { backoffMs, classifySendFailure, decide, type RequestFacts, type ReviewRequestSettings } from '@/lib/review-requests'
import { emailLang } from '@/lib/server/emails/copy'
import { reviewRequestEmail } from '@/lib/server/emails/review-request'
import { FROM_ADDRESS, emailMode, isMailConfigured, sendEmail, type SendEmailResult } from '@/lib/server/resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_LOCALE, isStorefrontLocale } from '@/lib/i18n'
import { localizedPath } from '@/lib/locale-routing'
import { getSiteUrl } from '@/lib/site-url'
import { ReviewRequestsUnavailable } from './schedule'
import { linkToken, tokenHash } from './tokens'

/**
 * Sends the review requests that are due. Run by /api/cron/review-requests
 * (hourly) — never from a request a customer or an admin is waiting on.
 *
 * ONE SEND PER REQUEST, whatever runs at once:
 *  - claim_review_requests (0060) hands each due row to one worker only
 *    (FOR UPDATE SKIP LOCKED) and marks it 'sending';
 *  - every later write is conditional on status = 'sending', so a row that
 *    staff cancelled meanwhile is not overwritten;
 *  - the email carries an idempotency key (request, link nonce, attempt):
 *    a worker that died after the provider accepted the email but before it
 *    was recorded is retried with the same key, and the provider sends nothing
 *    new.
 *
 * Eligibility is decided again HERE, from fresh data, just before sending
 * (lib/review-requests.ts decide): an order cancelled, refunded or flagged
 * after delivery, an unsubscribe, a review written in the meantime — all are
 * seen at the last moment.
 */

export type ProcessResult =
  | { status: 'disabled' | 'mail_not_configured' }
  | {
      status: 'ok'
      claimed: number
      sent: number
      suppressed: number
      deferred: number
      retrying: number
      failed: number
      errors: string[]
    }

type Claimed = {
  id: string
  order_id: string
  user_id: string | null
  delivered_at: string
  attempts: number
  token_nonce: string
}

type OrderRow = {
  id: string
  order_number: string
  user_id: string | null
  status: string
  payment_status: string | null
  customer_email: string | null
  customer_first_name: string | null
  customer_name: string | null
  locale: string | null
  delivered_at: string | null
  order_items: { product_id: string; name: string }[]
}

export async function processDue(settings: ReviewRequestSettings, opts: { limit?: number; now?: number } = {}): Promise<ProcessResult> {
  if (!settings.enabled) return { status: 'disabled' }
  if (!isMailConfigured) return { status: 'mail_not_configured' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('claim_review_requests', { p_limit: opts.limit ?? 25 })
  if (error) {
    if (['42883', 'PGRST202', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new ReviewRequestsUnavailable()
    throw new Error(`Could not claim review requests: ${error.message}`)
  }
  const claimed = (data ?? []) as Claimed[]
  const out = { status: 'ok' as const, claimed: claimed.length, sent: 0, suppressed: 0, deferred: 0, retrying: 0, failed: 0, errors: [] as string[] }

  for (const row of claimed) {
    try {
      const outcome = await handle(row, settings, opts.now ?? Date.now())
      out[outcome]++
    } catch (e) {
      // Unexpected (a database error mid-way). The row goes back to the queue
      // with a backoff so one bad row cannot spin the job.
      const message = (e as Error).message.slice(0, 300)
      out.errors.push(`${row.id}: ${message}`)
      await release(row, { status: 'scheduled', next_attempt_at: new Date(Date.now() + backoffMs(row.attempts + 1)).toISOString(), last_error: message })
    }
  }
  return out
}

type Outcome = 'sent' | 'suppressed' | 'deferred' | 'retrying' | 'failed'

async function release(row: Claimed, patch: Record<string, unknown>): Promise<void> {
  const { error } = await createAdminClient()
    .from('review_requests')
    .update({ ...patch, claimed_at: null })
    .eq('id', row.id)
    .eq('status', 'sending')
  if (error) console.error(`[review-requests] could not record ${row.id}: ${error.message}`)
}

async function handle(row: Claimed, settings: ReviewRequestSettings, now: number): Promise<Outcome> {
  const admin = createAdminClient()
  const { data: orderData, error: orderError } = await admin
    .from('orders')
    .select('id, order_number, user_id, status, payment_status, customer_email, customer_first_name, customer_name, locale, delivered_at, order_items(product_id, name)')
    .eq('id', row.order_id)
    .maybeSingle()
  if (orderError) throw new Error(`order read failed: ${orderError.message}`)
  const order = orderData as OrderRow | null
  if (!order) {
    await release(row, { status: 'suppressed', reason: 'not_delivered' })
    return 'suppressed'
  }

  const facts = await gatherFacts(row, order)
  const decision = decide(facts, settings, now)
  if (decision.action === 'suppress') {
    await release(row, { status: 'suppressed', reason: decision.reason })
    return 'suppressed'
  }
  if (decision.action === 'defer') {
    await release(row, { status: 'scheduled', next_attempt_at: new Date(decision.until).toISOString() })
    return 'deferred'
  }

  const token = linkToken(row.id, row.token_nonce)
  if (!token) throw new Error('no key for review links (REVIEW_LINK_SECRET / SUPABASE_SERVICE_ROLE_KEY)')
  const site = getSiteUrl()
  const lang = emailLang(order.locale)
  // The page in the email's language: /it/review/…, or bare for English (and
  // Russian, which the storefront does not have).
  const pageLocale = isStorefrontLocale(lang) ? lang : DEFAULT_LOCALE
  const reviewUrl = `${site}${localizedPath(`/review/${token}`, pageLocale)}`
  const unsubscribeUrl = `${site}${localizedPath(`/review/${token}/unsubscribe`, pageLocale)}`

  // The link must work the moment the email lands: stored before sending.
  const { error: tokenError } = await admin
    .from('review_requests')
    .update({ token_hash: tokenHash(token), token_expires_at: new Date(now + settings.linkValidDays * 86_400_000).toISOString() })
    .eq('id', row.id)
    .eq('status', 'sending')
  if (tokenError) throw new Error(`token write failed: ${tokenError.message}`)

  const names = uniqueNames(order.order_items)
  const message = reviewRequestEmail({
    lang,
    firstName: order.customer_first_name || order.customer_name,
    productNames: names,
    reviewUrl,
    unsubscribeUrl,
  })
  const result: SendEmailResult = await sendEmail({
    to: (facts.email as string).trim(),
    from: FROM_ADDRESS,
    ...message,
    headers: {
      // RFC 8058 one-click: the POST endpoint unsubscribes without a page.
      'List-Unsubscribe': `<${site}/api/review-requests/unsubscribe?token=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    idempotencyKey: `review-request/${row.id}/${row.token_nonce}/${row.attempts}`,
  })

  const attempts = row.attempts + 1
  if (result.ok) {
    await release(row, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      attempts,
      provider_message_id: result.id,
      next_attempt_at: null,
      // Test mode renders and logs but delivers nothing; say so in the admin.
      last_error: emailMode() === 'test' ? 'EMAIL_DELIVERY=test: rendered, not delivered to the customer' : null,
    })
    console.info(`[review-requests] sent for ${order.order_number}`)
    return 'sent'
  }

  const kind = classifySendFailure(result)
  const last_error = `${result.reason}${result.status ? ` ${result.status}` : ''}: ${result.message}`.slice(0, 500)
  if (kind === 'permanent' || attempts >= settings.maxAttempts) {
    await release(row, { status: 'failed', attempts, last_error, next_attempt_at: null })
    console.warn(`[review-requests] ${order.order_number} failed (${kind === 'permanent' ? 'permanent' : 'attempts exhausted'}): ${last_error}`)
    return 'failed'
  }
  await release(row, { status: 'scheduled', attempts, last_error, next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString() })
  return 'retrying'
}

function uniqueNames(items: { product_id: string; name: string }[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const i of items) {
    if (seen.has(i.product_id)) continue
    seen.add(i.product_id)
    out.push(i.name)
  }
  return out
}

async function gatherFacts(row: Claimed, order: OrderRow): Promise<RequestFacts> {
  const admin = createAdminClient()
  const email = order.customer_email?.trim().toLowerCase() ?? null
  const userId = order.user_id
  const productIds = Array.from(new Set(order.order_items.map((i) => i.product_id)))

  const [risk, suppression, consent, reviews, lastSent] = await Promise.all([
    admin.from('order_payment_risk').select('fraud_flag').eq('order_id', order.id).maybeSingle(),
    email
      ? admin.from('email_suppressions').select('email').eq('email', email).eq('kind', 'review_requests').maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    email
      ? admin
          .from('newsletter_subscribers')
          .select('email')
          .eq('email', email)
          .not('confirmed_at', 'is', null)
          .is('unsubscribed_at', null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    userId && productIds.length
      ? admin.from('reviews').select('product_id').eq('user_id', userId).in('product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
    userId
      ? admin
          .from('review_requests')
          .select('sent_at')
          .eq('user_id', userId)
          .neq('id', row.id)
          .not('sent_at', 'is', null)
          .order('sent_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ])
  // A failed read must not turn into "no fraud flag" or "not unsubscribed".
  for (const [what, r] of [
    ['fraud flag', risk],
    ['suppression list', suppression],
    ['consent', consent],
    ['reviews', reviews],
    ['previous sends', lastSent],
  ] as const) {
    if (r.error) throw new Error(`${what} read failed: ${r.error.message}`)
  }
  const reviewed = new Set(((reviews.data ?? []) as { product_id: string }[]).map((r) => r.product_id))
  const last = ((lastSent.data ?? []) as { sent_at: string }[])[0]?.sent_at

  return {
    orderStatus: order.status,
    paymentStatus: order.payment_status,
    fraudFlag: (risk.data as { fraud_flag: string | null } | null)?.fraud_flag ?? null,
    userId,
    email,
    deliveredAt: Date.parse(order.delivered_at ?? row.delivered_at),
    suppressed: Boolean(suppression.data),
    marketingConsent: Boolean(consent.data),
    unreviewedProducts: productIds.filter((p) => !reviewed.has(p)).length,
    lastSentToCustomerAt: last ? Date.parse(last) : null,
  }
}
