import { NextResponse, type NextRequest } from 'next/server'
import { answer, assistantStatus, type ChatMessage } from '@/lib/server/assistant/chat'
import { productIdFrom } from '@/lib/server/assistant/catalog'
import { readCredentials } from '@/lib/server/assistant/orders'
import { readJsonObjectLimited } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'
import type { StorefrontLocale } from '@/lib/types'

export const dynamic = 'force-dynamic'
// The turn's own budget is 20 s (LIMITS.totalMs); this leaves room for the
// session read and the response, within every Vercel plan's ceiling.
export const maxDuration = 30

const LOCALES: StorefrontLocale[] = ['en', 'it', 'fr', 'de']
/** The recent turns the model reads: enough for "and the other order?", few
 *  enough that a long chat costs the same as a short one. */
const MAX_TURNS = 12
const MAX_CHARS = 1000
/** All turns together: the oldest are dropped past this. */
const MAX_TOTAL_CHARS = 8000
/** 12 turns of 1 000 characters, in any script, plus 50 order credentials. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * The chat concierge (components/support/chat-bot.tsx).
 *
 *   POST { locale, messages: [{ role, text }], orders: [{ id, token }], context?: { productId } }
 *   → { mode: 'ai', reply, handoff?, products?, turnId }   an answer
 *   → { mode: 'fallback', reason, turnId }                 no answer this time: the
 *                                                          widget answers from the
 *                                                          help centre instead
 *
 * `orders` are the browser's own order tokens (lib/order-registry.ts), the
 * same credentials /api/orders/lookup takes; with the session they are the
 * only orders the concierge can see. `context.productId` is the product page
 * the chat was opened on; it is looked up in the catalogue here, never taken
 * on trust. See lib/server/assistant/ and docs/support-assistant.md.
 */
const OFF_REASON = {
  no_key: 'GEMINI_API_KEY is not set for this deployment',
  disabled: 'SUPPORT_ASSISTANT_AI=off',
} as const
let loggedOff = ''

/** Whether the concierge is on: the widget asks when it opens, so without a
 *  model it offers the help centre's prepared answers from the first tap.
 *  That path never reaches POST, so it would leave no trace in the log: say
 *  once per server instance why the chat is answering from templates. */
export function GET() {
  const status = assistantStatus()
  if (!status.on && loggedOff !== status.reason) {
    loggedOff = status.reason
    console.warn(`[assistant] the chat concierge is OFF (${OFF_REASON[status.reason]}): every chat answer comes from the help centre's prepared answers.`)
  }
  return NextResponse.json({ ai: status.on }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const limited = await enforceLimit('support.assistant', request)
  if (limited) return limited

  const body = await readJsonObjectLimited<{ locale?: unknown; messages?: unknown; orders?: unknown; context?: unknown }>(
    request,
    MAX_BODY_BYTES,
  )
  if (body === 'too_large') return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const locale = LOCALES.indexOf(body.locale as StorefrontLocale) !== -1 ? (body.locale as StorefrontLocale) : 'en'
  let messages: ChatMessage[] = (body.messages as { role?: unknown; text?: unknown }[])
    .slice(-MAX_TURNS * 2)
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role as ChatMessage['role'], text: (m.text as string).trim().slice(0, MAX_CHARS) }))
  // The oldest turns go first when the whole is too long.
  while (messages.length > 1 && messages.reduce((n, m) => n + m.text.length, 0) > MAX_TOTAL_CHARS) messages = messages.slice(1)
  // The model's side opens nothing: a conversation starts with the customer.
  const firstUser = messages.findIndex((m) => m.role === 'user')
  messages = firstUser === -1 ? [] : messages.slice(firstUser)
  // The conversation must end with the customer's question.
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No question' }, { status: 400 })
  }

  const context = body.context as { productId?: unknown } | undefined
  const productContext =
    context && typeof context === 'object' && typeof context.productId === 'string'
      ? productIdFrom(context.productId) ?? undefined
      : undefined

  const turnId = crypto.randomUUID()
  const outcome = await answer({
    locale,
    messages,
    credentials: readCredentials(body.orders),
    productContext,
    // The customer closed the widget or left the page: stop the model call.
    signal: request.signal,
  })
  const headers = { 'Cache-Control': 'no-store' }
  if (!outcome.ok) return NextResponse.json({ mode: 'fallback', reason: outcome.reason, turnId }, { headers })
  const { text, handoff, products } = outcome.reply
  return NextResponse.json(
    { mode: 'ai', reply: text, ...(handoff ? { handoff } : {}), ...(products.length ? { products } : {}), turnId },
    { headers },
  )
}
