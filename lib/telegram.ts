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
 * Optional — a forum group's TOPICS, one per kind of alert:
 *   TELEGRAM_THREAD_ORDERS    new orders, payments, status changes
 *   TELEGRAM_THREAD_ERRORS    crashes and failed jobs
 *   TELEGRAM_THREAD_STOCK     low stock, paid-but-sold-out
 *   TELEGRAM_THREAD_RETURNS   return requests
 * Each is the number at the end of a topic's link (t.me/c/<chat>/<THREAD>).
 * Unset, that kind of alert goes to the chat itself, exactly as before.
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

/** Which forum topic an alert belongs in. */
export type TelegramTopic = 'orders' | 'errors' | 'stock' | 'returns'

const TOPIC_ENV: Record<TelegramTopic, string> = {
  orders: 'TELEGRAM_THREAD_ORDERS',
  errors: 'TELEGRAM_THREAD_ERRORS',
  stock: 'TELEGRAM_THREAD_STOCK',
  returns: 'TELEGRAM_THREAD_RETURNS',
}

const warnedBadThread = new Set<string>()

/**
 * The topic's thread id, or undefined to post to the chat itself.
 *
 * Read on every call rather than once at start-up, so a topic added in the
 * hosting dashboard takes effect without a redeploy. Anything that is not a
 * positive whole number — a pasted link, a stray space, "abc" — is ignored
 * with one warning, and the alert goes to the main chat: a mistyped variable
 * must cost a tidy chat, never an alert.
 */
function threadFor(topic: TelegramTopic | undefined): number | undefined {
  if (!topic) return undefined
  const name = TOPIC_ENV[topic]
  const raw = process.env[name]?.trim()
  if (!raw) return undefined
  const id = Number(raw)
  if (Number.isInteger(id) && id > 0) return id
  if (!warnedBadThread.has(name)) {
    warnedBadThread.add(name)
    console.warn(`[telegram] ${name} is not a thread number; posting ${topic} alerts to the main chat`)
  }
  return undefined
}

/** Escapes text for Telegram's HTML parse mode (only these three matter). */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Posts one message. `html` must already be escaped wherever it interpolates
 * data (use escapeTelegramHtml). Returns whether Telegram accepted it.
 */
export async function sendTelegramMessage(html: string, topic?: TelegramTopic): Promise<boolean> {
  const cfg = config()
  if (!cfg) return false
  const text = html.length > MAX_MESSAGE_LENGTH ? `${html.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : html
  const thread = threadFor(topic)

  const post = (threadId: number | undefined) =>
    fetch(`${API_BASE}/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        ...(threadId ? { message_thread_id: threadId } : {}),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })

  try {
    let res = await post(thread)

    // A thread id that is SET but WRONG — the topic was deleted, the number
    // mistyped, the group is not a forum, or it names the General topic
    // (which Telegram only accepts WITHOUT a thread id). Telegram answers 400,
    // and without this the alert would simply be lost. One retry to the main
    // chat, so a stale variable costs the chat's tidiness and never the
    // message.
    if (!res.ok && thread && res.status === 400) {
      const detail = await res.text().catch(() => '')
      console.warn(
        `[telegram] ${topic} thread ${thread} refused (${detail.slice(0, 120)}); sending to the main chat instead`,
      )
      res = await post(undefined)
    }

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
async function dispatch(build: () => string, topic: TelegramTopic): Promise<boolean> {
  if (!config()) return false
  let html: string
  try {
    html = build()
  } catch (e) {
    console.warn('[telegram] could not format message:', (e as Error).message)
    return false
  }
  return sendTelegramMessage(html, topic)
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
    'orders',
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
  }, 'orders')
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
  }, 'orders')
}

/**
 * A customer has asked to send something back.
 *
 * It is a REQUEST, not a refund: nothing has moved, and nothing will until a
 * manager approves it. This message exists so the queue is discovered within
 * minutes rather than whenever somebody next opens the admin panel — a return
 * nobody looks at becomes a support ticket, and then a chargeback.
 */
export function notifyReturnRequested(
  order: Order,
  reason: string,
  comment: string,
): Promise<boolean> {
  return dispatch(() =>
    [
      `↩️ <b>Return requested</b> · ${esc(order.id)}`,
      ...orderLines(order),
      `Reason: <b>${esc(reason)}</b>`,
      // Bounded: a customer can write at length, and a chat message that runs
      // to three screens is one nobody reads.
      comment ? `“${esc(comment.slice(0, 400))}”` : '',
      'Review it in the admin before refunding.',
    ]
      .filter(Boolean)
      .join('\n'),
    'returns',
  )
}

/** A paid order whose stock had meanwhile been sold: needs a refund. */
export function notifyStockConflict(order: Order): Promise<boolean> {
  return dispatch(() =>
    [`⚠️ <b>Paid but out of stock</b>`, ...orderLines(order), 'Refund or restock needed.'].join('\n'),
    // A stock problem first and an order problem second: it is the stock
    // topic's watchers who can restock, and the refund follows from there.
    'stock',
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
  return sendTelegramMessage(`🚨 <b>${esc(context)}</b>\n<code>${esc(message.slice(0, 1500))}</code>`, 'errors')
}
