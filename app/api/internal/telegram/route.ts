import { NextResponse, type NextRequest } from 'next/server'
import { readJsonObject } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'
import { hasBearerSecret } from '@/lib/server/secure-compare'
import { escapeTelegramHtml, isTelegramConfigured, reportCriticalError, sendTelegramMessage } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * Internal dispatch to the operations Telegram chat, for callers outside this
 * app's own code: the external scheduler that runs the cron jobs, an uptime
 * monitor, a one-off script.
 *
 *   curl -X POST https://luxe-vault.store/api/internal/telegram \
 *     -H "Authorization: Bearer $INTERNAL_API_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"kind":"error","context":"Nightly backup","text":"pg_dump exited 1"}'
 *
 * `kind` is "message" (posted as plain text) or "error" (formatted and
 * deduplicated like the app's own critical errors). Text is always escaped —
 * callers cannot inject Telegram markup.
 *
 * Authenticated with INTERNAL_API_SECRET and failing closed without it: an
 * open version would let anyone post into the staff chat.
 */
const MAX_TEXT = 3000

export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (!hasBearerSecret(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limited = await enforceLimit('internal.telegram', request)
  if (limited) return limited

  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: 'Telegram is not configured' }, { status: 503 })
  }

  const body = await readJsonObject<{ kind?: unknown; text?: unknown; context?: unknown }>(request)
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : ''
  if (!body || !text) {
    return NextResponse.json({ error: 'A non-empty "text" is required' }, { status: 400 })
  }

  const sent =
    body.kind === 'error'
      ? await reportCriticalError(
          typeof body.context === 'string' && body.context.trim() ? body.context.trim().slice(0, 100) : 'External alert',
          text,
        )
      : await sendTelegramMessage(escapeTelegramHtml(text))

  return NextResponse.json({ sent })
}
