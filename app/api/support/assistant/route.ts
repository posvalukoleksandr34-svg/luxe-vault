import { NextResponse, type NextRequest } from 'next/server'
import { answer, isAssistantConfigured, type ChatMessage } from '@/lib/server/assistant/chat'
import { readCredentials } from '@/lib/server/assistant/orders'
import { readJsonObject } from '@/lib/server/http'
import { enforceLimit } from '@/lib/server/rate-limit'
import type { StorefrontLocale } from '@/lib/types'

export const dynamic = 'force-dynamic'

const LOCALES: StorefrontLocale[] = ['en', 'it', 'fr', 'de']
/** The recent turns the model reads: enough for "and the other order?", few
 *  enough that a long chat costs the same as a short one. */
const MAX_TURNS = 12
const MAX_CHARS = 1000

/**
 * The chat concierge (components/support/chat-bot.tsx).
 *
 *   POST { locale, messages: [{ role, text }], orders: [{ id, token }] }
 *   → { mode: 'ai', reply, handoff? }   an answer
 *   → { mode: 'fallback' }              no model available: the widget
 *                                       answers from the help centre instead
 *
 * `orders` are the browser's own order tokens (lib/order-registry.ts), the
 * same credentials /api/orders/lookup takes; with the session they are the
 * only orders the concierge can see. See lib/server/assistant/.
 */
/** Whether the concierge is on: the widget asks when it opens, so without a
 *  model it offers the help centre's prepared answers from the first tap. */
export function GET() {
  return NextResponse.json({ ai: isAssistantConfigured() })
}

export async function POST(request: NextRequest) {
  const limited = await enforceLimit('support.assistant', request)
  if (limited) return limited

  const body = await readJsonObject<{ locale?: unknown; messages?: unknown; orders?: unknown }>(request)
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const locale = LOCALES.indexOf(body.locale as StorefrontLocale) !== -1 ? (body.locale as StorefrontLocale) : 'en'
  const messages: ChatMessage[] = (body.messages as { role?: unknown; text?: unknown }[])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-MAX_TURNS)
    // The model's side opens nothing: a conversation starts with the customer.
    .filter((m, i, all) => all.slice(0, i + 1).some((x) => x.role === 'user'))
    .map((m) => ({ role: m.role as ChatMessage['role'], text: (m.text as string).trim().slice(0, MAX_CHARS) }))
  // The conversation must end with the customer's question.
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No question' }, { status: 400 })
  }

  const reply = await answer({ locale, messages, credentials: readCredentials(body.orders) })
  if (!reply) return NextResponse.json({ mode: 'fallback' })
  return NextResponse.json({ mode: 'ai', reply: reply.text, handoff: reply.handoff })
}
