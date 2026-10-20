import 'server-only'

import { SUPPORT_EMAIL } from '@/lib/data'
import type { CustomerEvent } from '@/lib/refunds/customer-copy'
import { formatMinor } from '@/lib/refunds/money'
import { emailLang } from '@/lib/server/emails/copy'
import { refundCaseEmail } from '@/lib/server/emails/refund-case'
import { sendOrderStatusEmail } from '@/lib/server/emails/send-lifecycle'
import { notifyRefundCase } from '@/lib/server/notifications'
import { getOrderById } from '@/lib/server/orders-store'
import { getOrderLocale } from '@/lib/server/order-locale'
import { FROM_ADDRESS, isMailConfigured, sendEmail } from '@/lib/server/resend'
import type { CaseRecord } from '@/lib/server/refunds/cases'
import { getCase } from '@/lib/server/refunds/cases'
import { createAdminClient } from '@/lib/supabase/admin'
import { escapeTelegramHtml, isTelegramConfigured, sendTelegramMessage } from '@/lib/telegram'

/**
 * Telling people a case moved — the customer (email + the in-app bell) and
 * the staff (Telegram, the 'returns' topic).
 *
 * EXACTLY ONCE. Each notification is a row in refund_notifications with a
 * unique dedupe key built from the case, the event and the transition it
 * belongs to (the case version it produced, or the message id). A retried
 * request, a redelivered webhook or two sweeps at once find the key taken and
 * send nothing. A send that fails stays 'failed' with its error, and the
 * sweep retries it (at most MAX_ATTEMPTS times); the case is never rolled
 * back because an email bounced.
 *
 * What a notification carries is listed in its payload: the case and order
 * numbers, an amount, the customer-facing note — never a risk score, an
 * internal note or a staff member's name. The address is read from the order
 * when sending, not stored here.
 */

const MAX_ATTEMPTS = 5

export type CustomerExtra = {
  amountMinor?: number
  note?: string
  deadline?: number
  instructions?: string
}

type Channel = 'email' | 'in_app' | 'staff'

async function enqueue(row: {
  caseId: string | null
  event: string
  channel: Channel
  dedupeKey: string
  payload: Record<string, unknown>
}): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('refund_notifications')
    .insert({
      case_id: row.caseId,
      event: row.event,
      channel: row.channel,
      dedupe_key: row.dedupeKey.slice(0, 300),
      payload: row.payload,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return null
    throw new Error(`Failed to queue a notification: ${error.message}`)
  }
  return data.id as string
}

async function mark(id: string, outcome: { status: 'sent' | 'failed' | 'skipped'; error?: string }, attempts: number): Promise<void> {
  const { error } = await createAdminClient()
    .from('refund_notifications')
    .update({
      status: outcome.status,
      attempts,
      last_error: outcome.error?.slice(0, 500) ?? null,
      sent_at: outcome.status === 'sent' ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) console.error(`[refunds] could not record notification ${id}: ${error.message}`)
}

async function deliver(
  id: string,
  channel: Channel,
  c: CaseRecord,
  event: string,
  payload: Record<string, unknown>,
  attempts: number,
): Promise<void> {
  try {
    if (channel === 'email') {
      const to = c.customerEmail?.trim()
      if (!to) return mark(id, { status: 'skipped', error: 'no address' }, attempts)
      if (!isMailConfigured) return mark(id, { status: 'skipped', error: 'mail not configured' }, attempts)
      const lang = emailLang(await getOrderLocale(c.orderNumber))
      const message = refundCaseEmail({
        lang,
        event: event as CustomerEvent,
        caseNumber: c.caseNumber,
        orderNumber: c.orderNumber,
        amountMinor: payload.amountMinor as number | undefined,
        note: payload.note as string | undefined,
        deadline: payload.deadline as number | undefined,
        instructions: payload.instructions as string | undefined,
      })
      const result = await sendEmail({ to, from: FROM_ADDRESS, replyTo: SUPPORT_EMAIL, ...message })
      return mark(id, result.ok ? { status: 'sent' } : { status: 'failed', error: result.message }, attempts)
    }
    if (channel === 'in_app') {
      if (!c.userId) return mark(id, { status: 'skipped', error: 'guest' }, attempts)
      const ok = await notifyRefundCase({
        userId: c.userId,
        orderId: c.orderNumber,
        caseNumber: c.caseNumber,
        event: event as CustomerEvent,
      })
      return mark(id, ok ? { status: 'sent' } : { status: 'failed', error: 'insert failed' }, attempts)
    }
    if (!isTelegramConfigured()) return mark(id, { status: 'skipped', error: 'telegram not configured' }, attempts)
    const ok = await sendTelegramMessage(String(payload.html ?? ''), 'returns')
    return mark(id, ok ? { status: 'sent' } : { status: 'failed', error: 'telegram send failed' }, attempts)
  } catch (e) {
    return mark(id, { status: 'failed', error: (e as Error).message }, attempts)
  }
}

/**
 * Tells the customer. `occurrence` makes the key unique per transition — the
 * case version the transition produced is the usual choice.
 */
export async function notifyCustomer(
  c: CaseRecord,
  event: CustomerEvent,
  occurrence: string | number,
  extra: CustomerExtra = {},
): Promise<void> {
  const payload = { ...extra }
  for (const channel of ['email', 'in_app'] as const) {
    try {
      const id = await enqueue({ caseId: c.id, event, channel, dedupeKey: `${c.id}:${event}:${occurrence}:${channel}`, payload })
      if (id) await deliver(id, channel, c, event, payload, 1)
    } catch (e) {
      // Queueing failed: the transition already happened and is recorded; the
      // customer can see it in their account. Logged loudly for a person.
      console.error(`[refunds] notification ${event} for ${c.caseNumber} not queued:`, (e as Error).message)
    }
  }
}

const STAFF_EVENTS = {
  created: '🆕 Новая заявка',
  high_risk: '⚠️ Высокий риск — нужна проверка человеком',
  awaiting_second_approval: '✍️ Нужно второе согласование',
  refund_failed: '❌ Возврат не прошёл',
  refund_unknown: '❓ Результат возврата неизвестен',
  refund_reversed: '↩️ Возврат отменён банком после успеха',
  sla_breach: '⏰ Просрочено решение',
  disputed: '⚖️ Спор по платежу',
  appeal: '🔁 Покупатель просит пересмотр',
  customer_replied: '💬 Ответ покупателя',
  delivery_wait_over: '📦 Окно доставки закрылось',
  restock_failed: '📦 Товар не вернулся на склад',
} as const
export type StaffEvent = keyof typeof STAFF_EVENTS

export async function notifyStaff(c: CaseRecord, event: StaffEvent, occurrence: string | number, details?: string): Promise<void> {
  const html = [
    `<b>${STAFF_EVENTS[event]}</b> · ${escapeTelegramHtml(c.caseNumber)}`,
    `Заказ ${escapeTelegramHtml(c.orderNumber)} · ${escapeTelegramHtml(c.claimType)}`,
    c.requestedAmountMinor ? `Сумма: ${formatMinor(c.approvedAmountMinor ?? c.requestedAmountMinor)}` : '',
    details ? escapeTelegramHtml(details.slice(0, 400)) : '',
    'Откройте заявку в админ-панели → Возвраты.',
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const id = await enqueue({ caseId: c.id, event, channel: 'staff', dedupeKey: `${c.id}:staff:${event}:${occurrence}`, payload: { html } })
    if (id) await deliver(id, 'staff', c, event, { html }, 1)
  } catch (e) {
    console.error(`[refunds] staff alert ${event} for ${c.caseNumber} not queued:`, (e as Error).message)
  }
}

/**
 * A refund made outside any case (the order screen, the fraud guard) reached
 * the customer: the order's own "refunded" email, once per ledger row.
 * Silence after money moves is what turns a refund into a chargeback.
 */
export async function notifyOrderRefunded(orderNumber: string, transactionId: string): Promise<void> {
  try {
    const id = await enqueue({
      caseId: null,
      event: 'order_refunded',
      channel: 'email',
      dedupeKey: `order:${orderNumber}:tx:${transactionId}:refunded`,
      payload: { orderNumber },
    })
    if (!id) return
    const order = await getOrderById(orderNumber)
    const ok = order ? await sendOrderStatusEmail(order, 'refunded') : false
    await mark(id, ok ? { status: 'sent' } : { status: 'failed', error: 'order email not sent' }, 1)
  } catch (e) {
    console.error(`[refunds] refund email for ${orderNumber} not queued:`, (e as Error).message)
  }
}

/** The sweep: queued or failed notifications, retried until MAX_ATTEMPTS. */
export async function retryNotifications(limit = 50): Promise<{ retried: number; sent: number }> {
  const { data, error } = await createAdminClient()
    .from('refund_notifications')
    .select('id, case_id, event, channel, payload, attempts, status')
    .in('status', ['queued', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .lt('created_at', new Date(Date.now() - 2 * 60_000).toISOString())
    .gt('created_at', new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order('created_at')
    .limit(limit)
  if (error) throw new Error(`Failed to read pending notifications: ${error.message}`)
  let sent = 0
  for (const n of data ?? []) {
    if (!n.case_id && n.event === 'order_refunded') {
      const number = String((n.payload as { orderNumber?: string } | null)?.orderNumber ?? '')
      const order = number ? await getOrderById(number) : null
      const ok = order ? await sendOrderStatusEmail(order, 'refunded') : false
      await mark(n.id as string, ok ? { status: 'sent' } : { status: 'failed', error: 'order email not sent' }, Number(n.attempts) + 1)
      if (ok) sent++
      continue
    }
    const c = n.case_id ? await getCase(n.case_id as string) : null
    if (!c) {
      await mark(n.id as string, { status: 'skipped', error: 'case gone' }, Number(n.attempts) + 1)
      continue
    }
    await deliver(n.id as string, n.channel as Channel, c, n.event as string, (n.payload as Record<string, unknown>) ?? {}, Number(n.attempts) + 1)
    const { data: after } = await createAdminClient().from('refund_notifications').select('status').eq('id', n.id).maybeSingle()
    if (after?.status === 'sent') sent++
  }
  return { retried: (data ?? []).length, sent }
}
