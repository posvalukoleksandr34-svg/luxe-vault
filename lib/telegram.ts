import 'server-only'

import { formatCharged } from '@/lib/currency'
import { getSiteUrl } from '@/lib/site-url'
import type { Order, OrderStatus } from '@/lib/types'

/**
 * Operations alerts to a Telegram chat: new orders, confirmed payments, order
 * status changes, and critical system errors.
 *
 * Configuration (both required; without them every call is a silent no-op):
 *   TELEGRAM_BOT_TOKEN   the token @BotFather gives the bot
 *   TELEGRAM_CHAT_ID     the chat, group or channel to post into (the bot must
 *                        be a member; a group id starts with "-100")
 *
 * PRIVACY: a Telegram chat is a third party. Messages carry order numbers,
 * amounts, payment method and destination country — never the customer's
 * name, email, phone or address. Staff open the order in the admin console
 * for those.
 *
 * RESILIENCE: nothing here throws, and every call gives up after a few
 * seconds. An alert failing must never fail the order, payment or webhook
 * that triggered it.
 */

const API_BASE = 'https://api.telegram.org'
const SEND_TIMEOUT_MS = 4000
/** Telegram's hard limit on one message. */
const MAX_MESSAGE_LENGTH = 4096
/** The same error is reported at most once per this window per instance, so
 *  a failing dependency cannot flood the chat. */
const ERROR_DEDUPE_MS = 10 * 60 * 1000

function config(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  return token && chatId ? { token, chatId } : null
}

export function isTelegramConfigured(): boolean {
  return config() !== null
}

/** Escapes text for Telegram's HTML parse mode (only these three matter). */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Posts one message. `html` must already be escaped wherever it interpolates
 * data (use escapeTelegramHtml). Returns whether Telegram accepted it.
 */
export async function sendTelegramMessage(html: string): Promise<boolean> {
  const cfg = config()
  if (!cfg) return false
  const text = html.length > MAX_MESSAGE_LENGTH ? `${html.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : html
  try {
    const res = await fetch(`${API_BASE}/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    if (!res.ok) {
      // The body names the problem ("chat not found", "bot was kicked");
      // the URL carries the token, so it is never logged.
      const detail = await res.text().catch(() => '')
      console.warn(`[telegram] sendMessage failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
      return false
    }
    return true
  } catch (e) {
    console.warn('[telegram] sendMessage failed:', (e as Error).message)
    return false
  }
}

// ------------------------------------------------------------ order events --

const esc = escapeTelegramHtml

/**
 * Builds and sends one event message. Skips the work entirely when Telegram is
 * not configured, and turns a formatting failure (an unexpected order shape)
 * into a logged `false` — the promise that nothing here throws covers the
 * message building too, not only the network call.
 */
async function dispatch(build: () => string): Promise<boolean> {
  if (!config()) return false
  let html: string
  try {
    html = build()
  } catch (e) {
    console.warn('[telegram] could not format message:', (e as Error).message)
    return false
  }
  return sendTelegramMessage(html)
}

function adminLink(): string {
  return `${getSiteUrl()}/admin`
}

function chf(amount: number): string {
  return formatCharged(amount, 'CHF')
}

function orderLines(order: Order): string[] {
  const units = (order.items ?? []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
  return [
    `<b>${esc(order.id)}</b> · ${esc(chf(order.total))}`,
    `${units} ${units === 1 ? 'item' : 'items'} · ${esc(order.payment)}${order.customer.country ? ` · ${esc(order.customer.country)}` : ''}`,
  ]
}

/** A new order was placed (not yet paid). */
export function notifyNewOrder(order: Order): Promise<boolean> {
  return dispatch(() =>
    ['🛍 <b>New order</b>', ...orderLines(order), `<a href="${esc(adminLink())}">Open admin</a>`].join('\n'),
  )
}

/** A payment settled. `charged` is what the provider actually took, when it
 *  differs from the CHF total (a EUR card charge, a coin amount). */
export function notifyPaymentConfirmed(
  order: Order,
  provider: 'stripe' | 'nowpayments',
  charged?: { amount: number; currency: string },
): Promise<boolean> {
  const via = provider === 'stripe' ? 'Stripe' : 'NOWPayments'
  return dispatch(() => {
    const paid =
      charged && charged.currency.toUpperCase() !== 'CHF'
        ? ` (${esc(
            provider === 'nowpayments'
              ? // Coins need their own precision; cents would show 0.0123 BTC as 0.01.
                `${charged.currency.toUpperCase()} ${charged.amount.toFixed(8).replace(/\.?0+$/, '')}`
              : formatCharged(charged.amount, charged.currency),
          )})`
        : ''
    return [`✅ <b>Payment confirmed</b> · ${via}`, ...orderLines(order).map((l, i) => (i === 0 ? l + paid : l))].join(
      '\n',
    )
  })
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
}

/** An order changed status (admin action, customer cancellation). */
export function notifyOrderStatus(order: Order, by: 'admin' | 'customer'): Promise<boolean> {
  return dispatch(() => {
    const tracking = order.trackingNumber ? `\nTracking: <code>${esc(order.trackingNumber)}</code>` : ''
    return `📦 <b>${esc(order.id)}</b> → ${STATUS_LABEL[order.status] ?? esc(String(order.status))} <i>(by ${by})</i>${tracking}`
  })
}

/** A paid order whose stock had meanwhile been sold: needs a refund. */
export function notifyStockConflict(order: Order): Promise<boolean> {
  return dispatch(() =>
    [`⚠️ <b>Paid but out of stock</b>`, ...orderLines(order), 'Refund or restock needed.'].join('\n'),
  )
}

// ------------------------------------------------------------------ errors --

const lastReported = new Map<string, number>()

/**
 * A critical failure worth a human's attention now: a webhook that could not
 * update an order, a scheduled job that failed. Deduplicated per `context` +
 * message for ten minutes. The message is trimmed, and never includes a stack.
 */
export async function reportCriticalError(context: string, error: unknown): Promise<boolean> {
  if (!config()) return false
  const message = error instanceof Error ? error.message : String(error)
  const key = `${context}|${message}`.slice(0, 300)
  const now = Date.now()
  const last = lastReported.get(key)
  if (last && now - last < ERROR_DEDUPE_MS) return false
  lastReported.set(key, now)
  if (lastReported.size > 200) {
    lastReported.forEach((at, k) => {
      if (now - at >= ERROR_DEDUPE_MS) lastReported.delete(k)
    })
  }
  return sendTelegramMessage(`🚨 <b>${esc(context)}</b>\n<code>${esc(message.slice(0, 1500))}</code>`)
}
