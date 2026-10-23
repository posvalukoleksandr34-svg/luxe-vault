import { z } from 'zod'

// No compiled validators: Zod 4 otherwise probes with `Function("")`, which the
// CSP (no 'unsafe-eval') reports. See lib/returns/schema.ts.
z.config({ jitless: true })

/**
 * Post-delivery review requests: the rules, with no I/O, so every decision the
 * worker makes can be tested on its own (tests/store/review-requests.test.ts).
 * The database and email side is lib/server/review-requests/.
 *
 * WHAT STARTS THE CLOCK: the order's confirmed delivery, orders.delivered_at.
 * The orders_stamp_status trigger writes it the first time the order is set
 * to 'delivered' and never moves it; shipped, out for delivery and estimated
 * dates do not count. One order travels as one parcel in this shop (there is
 * no shipment table), so "every item delivered" and "the order delivered" are
 * the same event; a split shipment is not something the data can express.
 *
 * WHO IS ASKED: the account holder of a delivered, paid order. Reviews belong
 * to an account (migration 0052: reviews.user_id is required and must be the
 * buyer), so a guest order is not asked: the link could not lead to a review
 * the customer is allowed to write. Customers are asked whatever their order
 * was like; an open complaint or a partial refund does not stop the request,
 * because asking only the happy ones would be selective solicitation. A
 * cancelled, fully refunded or fraud-flagged order is not asked.
 */

export const REVIEW_REQUEST_STATUSES = ['scheduled', 'sending', 'sent', 'failed', 'cancelled', 'suppressed'] as const
export type ReviewRequestStatus = (typeof REVIEW_REQUEST_STATUSES)[number]

/** Why a request was not sent. Codes, shown in Russian in the admin. */
export const SUPPRESS_REASONS = [
  'disabled',
  'not_delivered',
  'order_cancelled',
  'order_refunded',
  'fraud_flag',
  'guest_order',
  'no_valid_email',
  'unsubscribed',
  'no_marketing_consent',
  'already_reviewed',
  'stale',
  'staff_cancelled',
] as const
export type SuppressReason = (typeof SUPPRESS_REASONS)[number]

/**
 * CONSENT. Whether a review request may go to someone is a legal question the
 * owner answers once, here:
 *
 *  - 'marketing_consent' (the default): only to customers who confirmed a
 *    newsletter subscription (double opt-in, 0051). Nobody is emailed on the
 *    strength of an order alone.
 *  - 'existing_customer': to every eligible customer who has not opted out.
 *    Swiss UWG art. 3 (1) (o) and comparable EU rules allow this for a shop's
 *    own customers only if they were told at checkout that they may object,
 *    and every email offers the opt-out — the owner confirms the first part
 *    before choosing this (docs/review-requests.md).
 *
 * Either way every email carries a one-click unsubscribe that is honoured
 * before any later send.
 */
export const CONSENT_MODES = ['marketing_consent', 'existing_customer'] as const
export type ConsentMode = (typeof CONSENT_MODES)[number]

export const reviewRequestSettingsSchema = z
  .object({
    /** Off until the owner turns it on: requests are still scheduled, only sending waits. */
    enabled: z.boolean(),
    /** After the confirmed delivery. */
    delayHours: z.number().int().min(1).max(720),
    consentMode: z.enum(CONSENT_MODES),
    /** One email per customer per this many days: a later order's request waits, it is not dropped. */
    cooldownDays: z.number().int().min(0).max(90),
    /** Never ask about a delivery older than this — after downtime, or when sending was off. */
    staleAfterDays: z.number().int().min(3).max(180),
    /** Sends tried before a request is marked failed. */
    maxAttempts: z.number().int().min(1).max(10),
    /** How long the link in the email works after it was sent. */
    linkValidDays: z.number().int().min(7).max(365),
  })
  .refine((s) => s.staleAfterDays * 24 > s.delayHours, {
    message: 'The stale limit must be later than the delay',
    path: ['staleAfterDays'],
  })

export type ReviewRequestSettings = z.infer<typeof reviewRequestSettingsSchema>

export const DEFAULT_REVIEW_REQUEST_SETTINGS: ReviewRequestSettings = {
  enabled: false,
  delayHours: 48,
  consentMode: 'marketing_consent',
  cooldownDays: 7,
  staleAfterDays: 30,
  maxAttempts: 5,
  linkValidDays: 60,
}

/** Stored settings over the defaults; anything invalid falls back to the defaults. */
export function settingsFrom(raw: unknown): ReviewRequestSettings {
  const merged = { ...DEFAULT_REVIEW_REQUEST_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) }
  const parsed = reviewRequestSettingsSchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_REVIEW_REQUEST_SETTINGS
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** When to send: the confirmed delivery plus the delay. UTC milliseconds. */
export function scheduledAtFor(deliveredAt: number, settings: Pick<ReviewRequestSettings, 'delayHours'>): number {
  return deliveredAt + settings.delayHours * HOUR
}

/**
 * Retry delay after the n-th failed attempt (n ≥ 1): 15 min, 30 min, 1 h,
 * 2 h … capped at 12 h.
 */
export function backoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt))
  return Math.min(15 * 60 * 1000 * 2 ** (n - 1), 12 * HOUR)
}

/**
 * A plain address with nothing that could break a header: no spaces, no
 * CR/LF, no commas or angle brackets (several recipients, a display name).
 */
export function isSendableEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (v.length < 6 || v.length > 254) return false
  if (/[\s,;<>"\\]/.test(v)) return false
  return /^[^@]+@[^@]+\.[a-z]{2,}$/i.test(v)
}

export type SendFailure = { reason: 'not_configured' | 'rejected' | 'network'; status?: number; message: string }

/**
 * Whether trying again can help. A network failure, rate limiting and the
 * provider's own errors can; an address or message the provider refused
 * (400, 422) cannot. 401/403 is OUR key or domain: retried (it is not the
 * customer's fault and is fixed on our side), and alerted by the worker.
 */
export function classifySendFailure(f: SendFailure): 'retry' | 'permanent' {
  if (f.reason === 'network' || f.reason === 'not_configured') return 'retry'
  const s = f.status ?? 0
  if (s === 429 || s >= 500 || s === 401 || s === 403 || s === 0) return 'retry'
  if (s === 400 || s === 404 || s === 409 || s === 422) return 'permanent'
  return 'retry'
}

/** What the worker knows about a claimed request when it decides. */
export type RequestFacts = {
  orderStatus: string | null
  paymentStatus: string | null
  fraudFlag: string | null
  userId: string | null
  email: string | null
  deliveredAt: number
  suppressed: boolean
  /** A confirmed, active newsletter subscription for this address. */
  marketingConsent: boolean
  /** Products of this order the customer has not reviewed yet. */
  unreviewedProducts: number
  /** The last review request this customer was sent, for another order. */
  lastSentToCustomerAt: number | null
}

export type Decision = { action: 'send' } | { action: 'suppress'; reason: SuppressReason } | { action: 'defer'; until: number }

/**
 * Send, suppress (with why), or wait. The order is the order of the checks:
 * the order's own state first, then the customer's choices, then timing.
 * `enabled` is not checked here — a disabled feature leaves requests waiting
 * (the worker does not run), it does not suppress them.
 */
export function decide(f: RequestFacts, s: ReviewRequestSettings, now: number): Decision {
  if (f.orderStatus === 'cancelled') return { action: 'suppress', reason: 'order_cancelled' }
  if (f.orderStatus === 'refunded' || f.paymentStatus === 'refunded') return { action: 'suppress', reason: 'order_refunded' }
  if (f.orderStatus !== 'delivered') return { action: 'suppress', reason: 'not_delivered' }
  if (f.fraudFlag) return { action: 'suppress', reason: 'fraud_flag' }
  if (!f.userId) return { action: 'suppress', reason: 'guest_order' }
  if (!isSendableEmail(f.email)) return { action: 'suppress', reason: 'no_valid_email' }
  if (f.suppressed) return { action: 'suppress', reason: 'unsubscribed' }
  if (s.consentMode === 'marketing_consent' && !f.marketingConsent) return { action: 'suppress', reason: 'no_marketing_consent' }
  if (f.unreviewedProducts <= 0) return { action: 'suppress', reason: 'already_reviewed' }

  const staleAt = f.deliveredAt + s.staleAfterDays * DAY
  if (now >= staleAt) return { action: 'suppress', reason: 'stale' }

  if (s.cooldownDays > 0 && f.lastSentToCustomerAt !== null) {
    const until = f.lastSentToCustomerAt + s.cooldownDays * DAY
    if (now < until) return until < staleAt ? { action: 'defer', until } : { action: 'suppress', reason: 'stale' }
  }
  return { action: 'send' }
}

/** Russian labels for the admin (internal, Russian-only like the rest of it). */
export const STATUS_LABEL_RU: Record<ReviewRequestStatus, string> = {
  scheduled: 'Запланирован',
  sending: 'Отправляется',
  sent: 'Отправлен',
  failed: 'Ошибка',
  cancelled: 'Отменён',
  suppressed: 'Не отправлен',
}

export const REASON_LABEL_RU: Record<SuppressReason, string> = {
  disabled: 'Рассылка выключена',
  not_delivered: 'Заказ больше не «доставлен»',
  order_cancelled: 'Заказ отменён',
  order_refunded: 'Полный возврат',
  fraud_flag: 'Отметка о мошенничестве',
  guest_order: 'Гостевой заказ (отзыв требует аккаунта)',
  no_valid_email: 'Нет корректного email',
  unsubscribed: 'Покупатель отписался',
  no_marketing_consent: 'Нет согласия на рассылку',
  already_reviewed: 'Все товары уже оценены',
  stale: 'Слишком давно доставлен',
  staff_cancelled: 'Отменён сотрудником',
}
