import 'server-only'

import { createHmac } from 'node:crypto'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelPaymentIntent, getStripe } from '@/lib/server/stripe'
import { refundOrder } from '@/lib/server/refund-order'
import type { Order } from '@/lib/types'
import { escapeTelegramHtml, isTelegramConfigured, sendTelegramMessage } from '@/lib/telegram'

/**
 * Card-fraud guard (migration 0053). Stripe Radar scores every card payment
 * and blocks the riskiest on Stripe's side; this is what the shop does with
 * the signals Stripe sends back:
 *
 *   FAILED ATTEMPTS. Each declined card attempt on an order counts 1, a wrong
 *   CVC counts 2. At 3 the order's PaymentIntent is cancelled (so the same
 *   payment form cannot be used to try further cards), card payment for the
 *   order is locked, and the customer's email and IP are refused card
 *   payments for 24 hours.
 *
 *   FRAUD DECLINES. A decline that says the card is stolen, lost, or
 *   fraudulent, or a payment Radar blocked, locks at once, and the email and
 *   IP are refused for 30 days.
 *
 *   AFTER PAYMENT. A payment Radar let through with an "elevated" risk score,
 *   an early fraud warning from the card network, and a dispute each flag the
 *   order for the admin (Telegram + a badge in Admin → Orders). An early fraud
 *   warning on an order that has not shipped is refunded automatically: the
 *   money would almost certainly come back as a chargeback, with a fee, and
 *   the goods are still here.
 *
 * Everything degrades open on a database error (logged): a fraud guard that
 * takes card payments down when it has a bad minute does more harm than good,
 * and Radar still applies.
 */

// ------------------------------------------------------------- decisions ----

/** Declines that say the card or the payment is not legitimate. */
export const FRAUD_DECLINE_CODES = new Set([
  'fraudulent',
  'stolen_card',
  'lost_card',
  'pickup_card',
  'merchant_blacklist',
  'restricted_card',
  'security_violation',
])

/** Total weight of failed attempts at which an order is locked. */
export const LOCK_AT = 3

export const BLOCK_HOURS = { attempts: 24, fraud: 30 * 24 } as const

export type FailureKind = 'fraud' | 'cvc' | 'other'

/** What one failed attempt means, from the error Stripe attached to the intent. */
export function classifyFailure(
  error: { code?: string | null; decline_code?: string | null } | null | undefined,
  chargeOutcome?: { type?: string | null; risk_level?: string | null } | null,
): FailureKind {
  const decline = error?.decline_code ?? ''
  if (FRAUD_DECLINE_CODES.has(decline)) return 'fraud'
  if (chargeOutcome?.type === 'blocked' || chargeOutcome?.risk_level === 'highest') return 'fraud'
  if (error?.code === 'incorrect_cvc' || error?.code === 'invalid_cvc' || decline === 'incorrect_cvc') return 'cvc'
  return 'other'
}

export const FAILURE_WEIGHT: Record<FailureKind, number> = { fraud: LOCK_AT, cvc: 2, other: 1 }

/** Lock now? `failures` is the order's running total including this attempt. */
export function shouldLock(kind: FailureKind, failures: number): boolean {
  return kind === 'fraud' || failures >= LOCK_AT
}

/** The IP address, pseudonymised: HMAC keyed with a server secret, so the
 *  stored value cannot be reversed by trying every address. Null without a key. */
export function hashIp(ip: string): string | null {
  const key = process.env.PAYMENT_FRAUD_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key || !ip || ip === 'unknown') return null
  return createHmac('sha256', key).update(`lv-payment-ip:${ip}`).digest('hex')
}

// -------------------------------------------------------------- database ----

const MISSING = new Set(['42P01', 'PGRST205', '42883', 'PGRST202'])

function logDb(what: string, error: { code?: string; message?: string }) {
  if (MISSING.has(error.code ?? '')) console.error(`[fraud] ${what}: migration 0053 not applied — card lockout is OFF`)
  else console.error(`[fraud] ${what}:`, error.message)
}

async function orderUuid(orderNumber: string): Promise<string | null> {
  const { data } = await createAdminClient().from('orders').select('id').eq('order_number', orderNumber).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

async function upsertRisk(orderNumber: string, fields: Record<string, unknown>): Promise<void> {
  const id = await orderUuid(orderNumber)
  if (!id) return
  const { error } = await createAdminClient()
    .from('order_payment_risk')
    .upsert({ order_id: id, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'order_id' })
  if (error) logDb('risk upsert', error)
}

/**
 * Why this order may not start a card payment, or null when it may.
 * Checked by /api/payments/stripe/intent before a client secret is handed out.
 */
export async function cardPaymentRefusal(order: Order, ipHash: string | null): Promise<string | null> {
  const admin = createAdminClient()
  const id = await orderUuid(order.id)
  if (id) {
    const { data, error } = await admin.from('order_payment_risk').select('locked_at, lock_reason').eq('order_id', id).maybeSingle()
    if (error) logDb('lock check', error)
    else if (data?.locked_at) return `order locked: ${data.lock_reason ?? 'fraud guard'}`
  }

  const keys: { kind: 'email' | 'ip'; value: string }[] = []
  const email = order.customer.email?.trim().toLowerCase()
  if (email) keys.push({ kind: 'email', value: email })
  if (ipHash) keys.push({ kind: 'ip', value: ipHash })
  if (keys.length === 0) return null

  const { data, error } = await admin
    .from('payment_blocks')
    .select('kind, reason')
    .in('value', keys.map((k) => k.value))
    .gt('expires_at', new Date().toISOString())
  if (error) {
    logDb('block check', error)
    return null
  }
  const hit = (data ?? []).find((row) => keys.some((k) => k.kind === row.kind))
  return hit ? `${hit.kind} blocked: ${hit.reason}` : null
}

/** Remembers which (hashed) IP started this order's card payment. */
export async function recordPaymentIp(order: Order, ipHash: string | null): Promise<void> {
  if (ipHash) await upsertRisk(order.id, { ip_hash: ipHash })
}

async function block(order: Order, kind: FailureKind, reason: string): Promise<void> {
  const hours = kind === 'fraud' ? BLOCK_HOURS.fraud : BLOCK_HOURS.attempts
  const expires = new Date(Date.now() + hours * 3_600_000).toISOString()
  const admin = createAdminClient()
  const rows: { kind: string; value: string; reason: string; expires_at: string }[] = []
  const email = order.customer.email?.trim().toLowerCase()
  if (email) rows.push({ kind: 'email', value: email, reason, expires_at: expires })

  const id = await orderUuid(order.id)
  if (id) {
    const { data } = await admin.from('order_payment_risk').select('ip_hash').eq('order_id', id).maybeSingle()
    if (data?.ip_hash) rows.push({ kind: 'ip', value: data.ip_hash as string, reason, expires_at: expires })
  }
  if (rows.length === 0) return
  // A longer block already in place is kept: upsert only replaces on conflict,
  // so a 24 h block never shortens a running 30-day one (see the filter).
  const { data: existing } = await admin
    .from('payment_blocks')
    .select('kind, value, expires_at')
    .in('value', rows.map((r) => r.value))
  const longer = (r: (typeof rows)[number]) =>
    (existing ?? []).some((e) => e.kind === r.kind && e.value === r.value && (e.expires_at as string) > r.expires_at)
  const { error } = await admin.from('payment_blocks').upsert(rows.filter((r) => !longer(r)), { onConflict: 'kind,value' })
  if (error) logDb('block', error)
}

async function alert(html: string): Promise<void> {
  if (!isTelegramConfigured()) return
  await sendTelegramMessage(html, 'orders').catch(() => false)
}

// ---------------------------------------------------------------- events ----

/**
 * payment_intent.payment_failed: count the attempt; lock when it is one too
 * many or a fraud-type decline. Card attempts only — a customer backing out
 * of Klarna or TWINT is not a fraud signal.
 */
export async function onCardFailure(order: Order, intent: Stripe.PaymentIntent): Promise<{ kind: FailureKind; failures: number; locked: boolean } | null> {
  const error = intent.last_payment_error
  if (!error) return null
  const method = error.payment_method
  if (method && typeof method === 'object' && method.type !== 'card') return null

  // Radar's own blocks do not always carry a decline code; the charge's
  // outcome says so for certain.
  let outcome: { type?: string | null; risk_level?: string | null } | null = null
  if (!FRAUD_DECLINE_CODES.has(error.decline_code ?? '') && error.charge) {
    try {
      const chargeId = String(error.charge)
      outcome = (await getStripe().charges.retrieve(chargeId)).outcome ?? null
    } catch {
      outcome = null
    }
  }

  const kind = classifyFailure(error, outcome)
  const { data, error: rpcError } = await createAdminClient().rpc('record_card_failure', {
    p_payment_id: intent.id,
    p_weight: FAILURE_WEIGHT[kind],
  })
  if (rpcError) {
    logDb('record failure', rpcError)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  const failures = Number(row?.failures ?? 0)
  if (!shouldLock(kind, failures)) return { kind, failures, locked: false }

  const reason =
    kind === 'fraud'
      ? `fraud-type decline (${error.decline_code || outcome?.type || 'radar'})`
      : `${failures >= LOCK_AT ? 'too many failed card attempts' : 'failed attempts'}`
  // Cancelled first: once it is, the client secret in that browser is dead,
  // whatever happens to the bookkeeping below.
  const cancelled = await cancelPaymentIntent(intent.id)
  if (!cancelled.ok) console.error(`[fraud] could not cancel ${intent.id}: ${cancelled.message}`)
  await upsertRisk(order.id, { locked_at: new Date().toISOString(), lock_reason: reason })
  await block(order, kind, `${order.id}: ${reason}`)
  console.warn(`[fraud] ${order.id} card payment locked: ${reason}`)
  await alert(
    `🛑 <b>Оплата картой заблокирована</b>\nЗаказ <b>${escapeTelegramHtml(order.id)}</b>\n` +
      `Причина: ${escapeTelegramHtml(kind === 'fraud' ? `подозрение на мошенничество (${error.decline_code || 'Radar'})` : `${failures} неудачных попыток`)}\n` +
      `Email и IP не смогут платить картой ${kind === 'fraud' ? '30 дней' : '24 часа'}.`,
  )
  return { kind, failures, locked: true }
}

/**
 * payment_intent.succeeded: Radar let it through, but how risky did it look?
 * "elevated" is flagged for the admin; it is not refunded automatically, as
 * most such payments are genuine.
 */
export async function onCardSuccess(order: Order, intent: Stripe.PaymentIntent): Promise<string | null> {
  const chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id
  if (!chargeId) return null
  let risk: string | null | undefined
  try {
    risk = (await getStripe().charges.retrieve(chargeId)).outcome?.risk_level
  } catch {
    return null
  }
  if (risk !== 'elevated' && risk !== 'highest') return risk ?? null
  await upsertRisk(order.id, { fraud_flag: 'elevated_risk', fraud_flagged_at: new Date().toISOString() })
  await alert(
    `⚠️ <b>Повышенный риск мошенничества</b>\nЗаказ <b>${escapeTelegramHtml(order.id)}</b> оплачен, но Stripe Radar оценил риск как «${escapeTelegramHtml(risk)}».\n` +
      'Не отправляйте заказ, пока не проверите его (Stripe → Платёж → Risk insights).',
  )
  return risk
}

/**
 * radar.early_fraud_warning.created: the card network says the cardholder
 * reported this payment as fraud. Refunded automatically while the order has
 * not shipped; flagged either way.
 */
export async function onEarlyFraudWarning(order: Order, warning: Stripe.Radar.EarlyFraudWarning): Promise<'refunded' | 'flagged'> {
  await upsertRisk(order.id, { fraud_flag: 'early_fraud_warning', fraud_flagged_at: new Date().toISOString() })
  await block(order, 'fraud', `${order.id}: early fraud warning (${warning.fraud_type})`)

  const unshipped = order.status === 'pending' || order.status === 'processing'
  const paid = order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded'
  if (warning.actionable && unshipped && paid) {
    const refund = await refundOrder(order)
    if (refund.ok) {
      await alert(
        `🛑 <b>Early fraud warning — возврат сделан автоматически</b>\nЗаказ <b>${escapeTelegramHtml(order.id)}</b> (${escapeTelegramHtml(warning.fraud_type)}). ` +
          'Заказ ещё не был отправлен: деньги возвращены, заказ отменён. НЕ отправляйте его.',
      )
      return 'refunded'
    }
    console.error(`[fraud] automatic refund of ${order.id} failed: ${refund.message}`)
  }
  await alert(
    `🛑 <b>Early fraud warning</b>\nЗаказ <b>${escapeTelegramHtml(order.id)}</b> (${escapeTelegramHtml(warning.fraud_type)}). ` +
      (unshipped
        ? 'Автоматический возврат не удался — сделайте возврат вручную и не отправляйте заказ.'
        : 'Заказ уже отправлен. Рассмотрите возврат, чтобы избежать спора (chargeback) и комиссии.'),
  )
  return 'flagged'
}

/** charge.dispute.created: flag, block, tell the admin. Stripe handles the dispute itself. */
export async function onDispute(order: Order, dispute: Stripe.Dispute): Promise<void> {
  await upsertRisk(order.id, { fraud_flag: 'dispute', fraud_flagged_at: new Date().toISOString() })
  await block(order, 'fraud', `${order.id}: dispute (${dispute.reason})`)
  await alert(
    `⚖️ <b>Спор по платежу (chargeback)</b>\nЗаказ <b>${escapeTelegramHtml(order.id)}</b>, причина: ${escapeTelegramHtml(dispute.reason)}.\n` +
      'Ответьте в Stripe → Disputes до указанного срока (доказательства: трек-номер, переписка).',
  )
}

// ------------------------------------------------------------------ admin ----

export type OrderRisk = {
  failures: number
  lockedAt?: number
  lockReason?: string
  fraudFlag?: 'elevated_risk' | 'early_fraud_warning' | 'dispute'
}

/** Risk state for the admin's orders list, keyed by order number. */
export async function readOrderRisk(): Promise<Record<string, OrderRisk>> {
  const { data, error } = await createAdminClient()
    .from('order_payment_risk')
    .select('card_failures, locked_at, lock_reason, fraud_flag, orders!inner(order_number)')
    .or('locked_at.not.is.null,fraud_flag.not.is.null,card_failures.gt.0')
    .limit(1000)
  if (error) {
    logDb('admin read', error)
    return {}
  }
  const out: Record<string, OrderRisk> = {}
  for (const row of data ?? []) {
    const orders = row.orders as unknown as { order_number: string } | { order_number: string }[]
    const number = Array.isArray(orders) ? orders[0]?.order_number : orders?.order_number
    if (!number) continue
    out[number] = {
      failures: Number(row.card_failures) || 0,
      lockedAt: row.locked_at ? Date.parse(row.locked_at as string) : undefined,
      lockReason: (row.lock_reason as string | null) ?? undefined,
      fraudFlag: (row.fraud_flag as OrderRisk['fraudFlag'] | null) ?? undefined,
    }
  }
  return out
}

/**
 * Lets the admin unlock an order after checking it (a genuine customer who
 * mistyped, say): clears the order's lock and failure count, and lifts the
 * email/IP blocks that this order caused. The fraud flag stays.
 */
export async function unlockOrder(orderNumber: string): Promise<boolean> {
  const id = await orderUuid(orderNumber)
  if (!id) return false
  const admin = createAdminClient()
  const { error } = await admin
    .from('order_payment_risk')
    .update({ locked_at: null, lock_reason: null, card_failures: 0, updated_at: new Date().toISOString() })
    .eq('order_id', id)
  if (error) {
    logDb('unlock', error)
    return false
  }
  const { error: blockError } = await admin.from('payment_blocks').delete().like('reason', `${orderNumber}:%`)
  if (blockError) logDb('unlock blocks', blockError)
  return true
}
