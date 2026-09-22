import 'server-only'

import { reportCriticalError } from '@/lib/telegram'

/**
 * Where a crash report actually goes. SERVER ONLY.
 *
 * The transports live behind a `server-only` import for a reason that is worth
 * stating plainly: the Telegram token and SYSTEM_ALERT_WEBHOOK are credentials
 * for posting into the operators' own chat. Anything that reaches the browser
 * bundle reaches everyone, and a leaked webhook URL is an open pipe for
 * strangers to write into that chat. A client crash therefore never talks to
 * the sink directly — it posts to /api/monitoring/report, which is rate
 * limited, and THAT calls this.
 *
 * Two sinks, both optional, tried independently:
 *
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   the operations bot this shop
 *                                           already uses (lib/telegram.ts),
 *                                           which dedupes and formats.
 *   SYSTEM_ALERT_WEBHOOK                    a Slack or Discord incoming
 *                                           webhook, for teams that watch one
 *                                           of those instead.
 *
 * With neither set, alerting is simply off and every call is a no-op that
 * still logs to the server console. That is deliberate: a shop must not fail
 * to start because nobody has configured a chat bot.
 */

export type CrashReport = {
  /** Where it happened, in words: "Checkout", "Stripe intent", "UI crash". */
  context: string
  message: string
  /** Trimmed before it gets here; see formatReport. */
  stack?: string
  /** The page the visitor was on, with its query string scrubbed. */
  url?: string
  /** Next's error digest, which is the only way to tie a client-side report to
   *  the server log line that produced it. */
  digest?: string
  timestamp: string
}

/** How much of a stack is useful in a chat message. The top frames are where
 *  the fault is; the rest is framework plumbing that pushes the useful part
 *  off the screen. */
const STACK_LINES = 8
const STACK_CHARS = 1200

/**
 * A URL safe to put in a message.
 *
 * Query strings carry tokens — an order's lookup token, a password-recovery
 * code, a signed URL — and a crash report is not worth leaking one into a chat
 * that may be forwarded. The path is kept because it is what identifies the
 * page; the values are not.
 */
export function scrubUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    const kept: string[] = []
    url.searchParams.forEach((_value, key) => kept.push(key))
    url.search = kept.length > 0 ? `?${kept.map((k) => `${k}=…`).join('&')}` : ''
    url.hash = ''
    return url.toString().slice(0, 300)
  } catch {
    // Not a URL — a bare path, most likely. Keep it, minus anything after a ?.
    return raw.split('?')[0]?.slice(0, 300)
  }
}

/** One human-readable block. Used by both sinks so a Slack alert and a
 *  Telegram alert say the same thing. */
export function formatReport(report: CrashReport): string {
  const stack = report.stack
    ? report.stack.split('\n').slice(0, STACK_LINES).join('\n').slice(0, STACK_CHARS)
    : ''

  return [
    report.message,
    report.url ? `at ${report.url}` : '',
    report.digest ? `digest ${report.digest}` : '',
    report.timestamp,
    stack ? `\n${stack}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function postGenericWebhook(url: string, text: string): Promise<boolean> {
  // `text` suits Slack, `content` suits Discord. Sending both means one
  // payload works for either without the operator telling us which they use —
  // each ignores the key it does not know.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
    // A monitoring call must never be the thing that hangs a request.
    signal: AbortSignal.timeout(5000),
  })
  return res.ok
}

/**
 * Reports a crash to whichever sinks are configured.
 *
 * NEVER THROWS. This is called from catch blocks, including ones in the
 * payment path: an alerting system that can itself raise turns a recoverable
 * failure into a lost order. Every transport is individually guarded, and the
 * console line is written first so the report survives even when every sink
 * is down or unconfigured.
 */
export async function sendCrashReport(report: CrashReport): Promise<void> {
  const body = formatReport(report)

  // Always, and first: the platform's own logs are the one sink that cannot
  // be misconfigured.
  console.error(`[crash] ${report.context}: ${body}`)

  const webhook = process.env.SYSTEM_ALERT_WEBHOOK?.trim()

  await Promise.allSettled([
    // Telegram, via the existing reporter — it dedupes per context+message for
    // ten minutes, which is what stops one failing page from sending a
    // thousand messages.
    (async () => {
      try {
        await reportCriticalError(report.context, report.message)
      } catch (error) {
        console.warn('[crash] telegram sink failed:', (error as Error).message)
      }
    })(),

    (async () => {
      if (!webhook) return
      try {
        const ok = await postGenericWebhook(webhook, `🚨 ${report.context}\n${body}`)
        if (!ok) console.warn('[crash] webhook sink returned a non-2xx')
      } catch (error) {
        console.warn('[crash] webhook sink failed:', (error as Error).message)
      }
    })(),
  ])
}

/**
 * The shape used from a server catch block.
 *
 * `await` it or do not — it resolves rather than rejects either way, so a
 * forgotten await cannot produce an unhandled rejection.
 */
export function reportServerError(context: string, error: unknown, url?: string): Promise<void> {
  const err = error instanceof Error ? error : undefined
  return sendCrashReport({
    context,
    message: err?.message ?? String(error),
    stack: err?.stack,
    url: scrubUrl(url),
    digest: (error as { digest?: string })?.digest,
    timestamp: new Date().toISOString(),
  })
}
