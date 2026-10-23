import 'server-only'

import { REVIEW_REQUEST_STATUSES, type ReviewRequestStatus } from '@/lib/review-requests'
import { BUSINESS } from '@/config/business'
import { EMAIL_LANGS, type EmailLang } from '@/lib/server/emails/copy'
import { reviewRequestEmail } from '@/lib/server/emails/review-request'
import { FROM_ADDRESS, sendEmail } from '@/lib/server/resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteUrl } from '@/lib/site-url'
import { ReviewRequestsUnavailable, unavailable } from './schedule'

/**
 * The admin side of review requests: the list, the figures, and the few
 * actions staff may take. Authorization is the route's job (requireAdmin +
 * requireStaff); everything here assumes it was checked.
 */

export type RequestRow = {
  id: string
  orderNumber: string
  customerName: string
  customerEmail: string
  status: ReviewRequestStatus
  reason: string | null
  deliveredAt: string
  scheduledAt: string
  nextAttemptAt: string | null
  sentAt: string | null
  attempts: number
  lastError: string | null
  reviewsSubmitted: number
  products: string[]
}

export type ListFilter = {
  statuses: ReviewRequestStatus[]
  q?: string
  product?: string
  from?: string
  to?: string
  page: number
  pageSize: number
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Only known values reach a query; everything else is dropped. */
export function parseListFilter(p: URLSearchParams): ListFilter {
  const statuses = (p.get('status') ?? '')
    .split(',')
    .filter((s): s is ReviewRequestStatus => (REVIEW_REQUEST_STATUSES as readonly string[]).includes(s))
  const clean = (v: string | null, max: number) => {
    const t = (v ?? '').trim().slice(0, max)
    return t ? t.replace(/[%_\\(),.*]/g, ' ').replace(/\s+/g, ' ').trim() || undefined : undefined
  }
  const day = (v: string | null) => (v && ISO_DAY.test(v) ? v : undefined)
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(p.get('page')) || 1)))
  const pageSize = Math.max(10, Math.min(100, Math.floor(Number(p.get('pageSize')) || 25)))
  // The order number keeps its hyphen; it is matched on its own pattern.
  const rawQ = (p.get('q') ?? '').trim().slice(0, 80)
  const q = /^LV-[A-Z0-9]{1,12}$/i.test(rawQ) ? rawQ.toUpperCase() : rawQ.includes('@') ? rawQ.toLowerCase().replace(/[%_\\(),*]/g, '') : clean(rawQ, 80)
  return { statuses, q: q || undefined, product: clean(p.get('product'), 80), from: day(p.get('from')), to: day(p.get('to')), page, pageSize }
}

export async function listRequests(f: ListFilter): Promise<{ rows: RequestRow[]; total: number }> {
  const admin = createAdminClient()
  let q = admin
    .from('review_requests')
    .select(
      `id, status, reason, delivered_at, scheduled_at, next_attempt_at, sent_at, attempts, last_error, reviews_submitted,
       orders!inner(order_number, customer_name, customer_email, order_items${f.product ? '!inner' : ''}(name))`,
      { count: 'exact' },
    )
  if (f.statuses.length) q = q.in('status', f.statuses)
  if (f.q) {
    if (/^LV-/.test(f.q)) q = q.ilike('orders.order_number', `${f.q}%`)
    else if (f.q.includes('@')) q = q.ilike('orders.customer_email', `%${f.q}%`)
    else q = q.ilike('orders.customer_name', `%${f.q}%`)
  }
  if (f.product) q = q.ilike('orders.order_items.name', `%${f.product}%`)
  if (f.from) q = q.gte('scheduled_at', `${f.from}T00:00:00Z`)
  if (f.to) q = q.lte('scheduled_at', `${f.to}T23:59:59Z`)
  const start = (f.page - 1) * f.pageSize
  const { data, error, count } = await q.order('scheduled_at', { ascending: false }).range(start, start + f.pageSize - 1)
  if (error) {
    if (unavailable(error)) throw new ReviewRequestsUnavailable()
    throw new Error(`Could not list review requests: ${error.message}`)
  }
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const o = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as {
      order_number: string
      customer_name: string | null
      customer_email: string | null
      order_items: { name: string }[]
    }
    return {
      id: r.id as string,
      orderNumber: o.order_number,
      customerName: o.customer_name ?? '',
      customerEmail: o.customer_email ?? '',
      status: r.status as ReviewRequestStatus,
      reason: (r.reason as string | null) ?? null,
      deliveredAt: r.delivered_at as string,
      scheduledAt: r.scheduled_at as string,
      nextAttemptAt: (r.next_attempt_at as string | null) ?? null,
      sentAt: (r.sent_at as string | null) ?? null,
      attempts: Number(r.attempts) || 0,
      lastError: (r.last_error as string | null) ?? null,
      reviewsSubmitted: Number(r.reviews_submitted) || 0,
      products: Array.from(new Set((o.order_items ?? []).map((i) => i.name))),
    }
  })
  return { rows, total: count ?? rows.length }
}

export type Metrics = {
  byStatus: Record<ReviewRequestStatus, number>
  sent30d: number
  withReview: number
  reviewsSubmitted: number
  /** Share of sent requests that led to at least one review; null before any was sent. */
  conversion: number | null
}

export async function requestMetrics(now = Date.now()): Promise<Metrics> {
  const admin = createAdminClient()
  const count = async (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count: n, error } = await build(base())
    if (error) {
      if (unavailable(error)) throw new ReviewRequestsUnavailable()
      throw new Error(`Could not count review requests: ${error.message}`)
    }
    return n ?? 0
  }
  const base = () => admin.from('review_requests').select('id', { count: 'exact', head: true })
  const statusCounts = await Promise.all(REVIEW_REQUEST_STATUSES.map((s) => count((q) => q.eq('status', s))))
  const byStatus = Object.fromEntries(REVIEW_REQUEST_STATUSES.map((s, i) => [s, statusCounts[i]])) as Record<ReviewRequestStatus, number>
  const since = new Date(now - 30 * 86_400_000).toISOString()
  const [sent30d, withReview, everSent] = await Promise.all([
    count((q) => q.gte('sent_at', since)),
    count((q) => q.not('first_review_at', 'is', null)),
    count((q) => q.not('sent_at', 'is', null)),
  ])
  const { data: sums, error } = await admin.from('review_requests').select('reviews_submitted').gt('reviews_submitted', 0).limit(10_000)
  if (error) throw new Error(`Could not sum reviews: ${error.message}`)
  const reviewsSubmitted = ((sums ?? []) as { reviews_submitted: number }[]).reduce((a, r) => a + (Number(r.reviews_submitted) || 0), 0)
  return { byStatus, sent30d, withReview, reviewsSubmitted, conversion: everSent > 0 ? withReview / everSent : null }
}

/** A failed (or staff-cancelled) request goes back to the queue with a fresh
 *  link nonce, so a link from an earlier attempt stops working. */
export async function retryRequest(id: string): Promise<'ok' | 'not_retryable'> {
  const { data, error } = await createAdminClient()
    .from('review_requests')
    .update({
      status: 'scheduled',
      reason: null,
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
      token_hash: null,
      token_expires_at: null,
      token_nonce: crypto.randomUUID().replace(/-/g, ''),
    })
    .eq('id', id)
    .in('status', ['failed', 'cancelled'])
    .select('id')
  if (error) throw new Error(`Could not retry: ${error.message}`)
  return (data ?? []).length ? 'ok' : 'not_retryable'
}

/** Only a request that has not gone out can be cancelled. */
export async function cancelRequest(id: string): Promise<'ok' | 'not_cancellable'> {
  const { data, error } = await createAdminClient()
    .from('review_requests')
    .update({ status: 'cancelled', reason: 'staff_cancelled', next_attempt_at: null })
    .eq('id', id)
    .in('status', ['scheduled', 'failed'])
    .select('id')
  if (error) throw new Error(`Could not cancel: ${error.message}`)
  return (data ?? []).length ? 'ok' : 'not_cancellable'
}

const SAMPLE_PRODUCTS = ['Cashmere coat', 'Silk scarf']

/** The email as a customer would get it, with sample names and inert links. */
export function previewEmail(lang: EmailLang) {
  const site = getSiteUrl()
  return reviewRequestEmail({
    lang,
    firstName: 'Anna',
    productNames: SAMPLE_PRODUCTS,
    reviewUrl: `${site}/review/preview`,
    unsubscribeUrl: `${site}/review/preview/unsubscribe`,
  })
}

/**
 * Addresses a test email may go to: the shop's own (BUSINESS.email), the
 * test-mode inbox (EMAIL_TEST_RECIPIENT) and any in REVIEW_TEST_RECIPIENTS.
 * Never an address typed into the admin — the test button must not be a way
 * to mail arbitrary people.
 */
export function testRecipients(): string[] {
  const list = [BUSINESS.email, process.env.EMAIL_TEST_RECIPIENT, ...(process.env.REVIEW_TEST_RECIPIENTS ?? '').split(',')]
    .map((v) => (v ?? '').trim().toLowerCase())
    .filter((v) => /^[^@\s,;<>]+@[^@\s,;<>]+\.[a-z]{2,}$/i.test(v))
  return Array.from(new Set(list))
}

export async function sendTestEmail(to: string, lang: EmailLang): Promise<{ ok: true } | { ok: false; error: string }> {
  const address = to.trim().toLowerCase()
  if (!testRecipients().includes(address)) return { ok: false, error: 'not_allowed' }
  const m = previewEmail(EMAIL_LANGS.includes(lang) ? lang : 'en')
  const result = await sendEmail({ to: address, from: FROM_ADDRESS, ...m, subject: `[TEST] ${m.subject}` })
  return result.ok ? { ok: true } : { ok: false, error: `${result.reason}${result.status ? ` ${result.status}` : ''}` }
}
