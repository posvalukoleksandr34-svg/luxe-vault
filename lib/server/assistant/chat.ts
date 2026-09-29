import 'server-only'

import { FinishReason, ThinkingLevel, type Content, type FunctionCall, type FunctionDeclaration } from '@google/genai'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { geminiClient } from '@/lib/server/gemini'
import { getShippingSettings } from '@/lib/server/store-settings'
import { getCurrentUser } from '@/lib/supabase/server'
import type { Order } from '@/lib/types'
import { SUPPORT_CATEGORIES, type SupportCategory, type StorefrontLocale } from '@/lib/types'
import { knowledgeFor } from './knowledge'
import {
  normalizeOrderNumber,
  orderForAssistant,
  orderSummary,
  requesterOrders,
  type OrderCredential,
} from './orders'
import { systemPrompt } from './prompt'

/**
 * One turn of the concierge: the conversation so far in, one reply out.
 *
 * Stateless — the browser sends the recent messages each time — and bounded:
 * a capped history, at most three rounds of tool calls, a hard timeout. Any
 * failure (no key, timeout, a blocked or empty answer) returns null, and the
 * widget falls back to the help centre's prepared answers, so the chat never
 * shows an error for the model's sake.
 */

export type ChatMessage = { role: 'user' | 'assistant'; text: string }

export type AssistantReply = {
  text: string
  /** Set when the concierge handed over: the widget raises "Write to support"
   *  with the category chosen, and the summary pre-filled. */
  handoff?: { category: SupportCategory; summary: string }
}

/** Same default as smart search, the stylist and translation; GEMINI_MODEL overrides. */
const DEFAULT_MODEL = 'gemini-3.6-flash'
const TIMEOUT_MS = 15_000
const MAX_TOOL_ROUNDS = 3

export function isAssistantConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim()) && process.env.SUPPORT_ASSISTANT_AI !== 'off'
}

const TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_order_status',
    description:
      "Look up one of the customer's own orders by its number: status, payment, items, delivery estimate, tracking, return window.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        order_number: { type: 'string', description: 'The order number as the customer gave it, e.g. LV-7K2M9Q.' },
      },
      required: ['order_number'],
    },
  },
  {
    name: 'list_my_orders',
    description: "List the customer's own recent orders (number, date, status, items), newest first.",
  },
  {
    name: 'offer_human_support',
    description:
      'Hand the conversation to the human support team. Shows the customer a "Write to support" button with the request pre-filled.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: SUPPORT_CATEGORIES },
        summary: {
          type: 'string',
          description:
            "The customer's request in one or two sentences, written as the customer (first person) in their language, ready for them to send to the team; they can edit it.",
        },
      },
      required: ['category', 'summary'],
    },
  },
]

export async function answer(opts: {
  locale: StorefrontLocale
  messages: ChatMessage[]
  credentials: OrderCredential[]
}): Promise<AssistantReply | null> {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key || process.env.SUPPORT_ASSISTANT_AI === 'off') return null

  // Who is asking: the verified session, if any. A failed read counts as
  // "not signed in" — the safe side.
  const userId = await getCurrentUser()
    .then((user) => user?.id ?? null)
    .catch(() => null)
  // The order list is loaded lazily — only a question about an order needs
  // the database — and once, however many tools ask for it.
  let orders: Order[] | null = null
  const loadOrders = async () => (orders ??= await requesterOrders(opts.credentials, userId))
  let handoff: AssistantReply['handoff']

  async function run(call: FunctionCall): Promise<Record<string, unknown>> {
    const args = (call.args ?? {}) as Record<string, unknown>
    if (call.name === 'get_order_status') {
      const number = normalizeOrderNumber(String(args.order_number ?? ''))
      if (!number) return { error: 'invalid_number', hint: 'Order numbers look like LV-XXXXXX.' }
      const mine = await loadOrders()
      const order = mine.find((o) => o.id === number)
      return order ? { order: orderForAssistant(order) } : { error: 'not_visible', orderNumber: number }
    }
    if (call.name === 'list_my_orders') {
      const mine = await loadOrders()
      return { orders: mine.slice(0, 5).map(orderSummary) }
    }
    if (call.name === 'offer_human_support') {
      const category = SUPPORT_CATEGORIES.indexOf(args.category as SupportCategory) !== -1 ? (args.category as SupportCategory) : 'other'
      handoff = { category, summary: String(args.summary ?? '').slice(0, 500) }
      return { ok: true, button: 'Write to support' }
    }
    return { error: 'unknown_tool' }
  }

  const shipping = await getShippingSettings()
  const system = systemPrompt({
    locale: opts.locale,
    today: new Date().toISOString().slice(0, 10),
    signedIn: userId !== null,
    replyWithin: describeBusinessDays(FULFILMENT.supportReply, opts.locale, { genitive: true }),
    knowledge: knowledgeFor(opts.locale, shipping),
  })

  const contents: Content[] = opts.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const ai = geminiClient(key)
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        contents,
        config: {
          systemInstruction: system,
          // After the last allowed round the model must answer in words.
          tools: round < MAX_TOOL_ROUNDS ? [{ functionDeclarations: TOOLS }] : undefined,
          temperature: 0.3,
          maxOutputTokens: 700,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: controller.signal,
        },
      })
      const candidate = res.candidates?.[0]
      const calls = res.functionCalls
      if (calls && calls.length > 0 && candidate?.content) {
        contents.push(candidate.content)
        const responses = []
        for (const call of calls) {
          responses.push({ functionResponse: { id: call.id, name: call.name, response: await run(call) } })
        }
        contents.push({ role: 'user', parts: responses })
        continue
      }
      const text = res.text?.trim()
      if (candidate?.finishReason !== FinishReason.STOP || !text) return null
      return { text: text.slice(0, 2000), handoff }
    }
    return null
  } catch (e) {
    console.warn('[assistant] answer skipped:', (e as Error).message)
    return null
  } finally {
    clearTimeout(timer)
  }
}
