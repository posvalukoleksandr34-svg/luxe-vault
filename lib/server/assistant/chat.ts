import 'server-only'

import { ApiError, FinishReason, ThinkingLevel, type Content } from '@google/genai'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { geminiClient } from '@/lib/server/gemini'
import { readCatalog, type Catalog } from '@/lib/server/catalog-store'
import { getShippingSettings } from '@/lib/server/store-settings'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/supabase/server'
import { DEFAULT_SHIPPING_SETTINGS, type ShippingSettings } from '@/config/shipping'
import type { Order, Product, SupportCategory, StorefrontLocale } from '@/lib/types'
import {
  card,
  detail,
  findProduct,
  searchCatalog,
  summarize,
  type KeywordSearch,
  type ProductCard,
} from './catalog'
import { amountsIn, checkReply, collectEvidence, detectLanguage, expectedLanguage, redactPersonalData, type Evidence } from './guard'
import { knowledgeFor } from './knowledge'
import { assistantEvent, emptyMetrics, type FallbackReason, type TurnMetrics } from './metrics'
import { orderForAssistant, orderSummary, requesterOrders, type OrderCredential } from './orders'
import { LANGUAGE_NAME, systemPrompt } from './prompt'
import { TOOLS, isInvalid, validateCall, type ValidArgs } from './tools'

/**
 * One turn of the concierge: the conversation so far in, one checked reply
 * (or a typed reason for falling back) out.
 *
 * STATELESS. The browser sends the recent turns each time; nothing is kept
 * here between requests, so two tabs or two quick questions cannot corrupt a
 * shared state. Authority is re-derived on every request: the session from
 * its cookie, the browser's order tokens checked against the database — never
 * from what the conversation says.
 *
 * BOUNDED, in every dimension a customer or a model could stretch:
 *   time        LIMITS.totalMs for the whole turn, every model call included;
 *               closing the widget aborts the request and with it the call
 *   tool use    at most LIMITS.maxRounds rounds, maxCallsPerRound per round,
 *               maxCalls per turn; an identical call is answered from cache
 *   tool output each result capped at toolResponseChars before the model
 *               reads it
 *   output      maxOutputTokens, then REPLY_MAX_CHARS after checking
 *   retries     one, and only for a provider 5xx with time left — never for
 *               a timeout, a rate limit or a refusal
 *
 * Any failure returns { ok: false, reason } and the widget answers from the
 * help centre's prepared answers instead (and keeps "Write to support" one tap
 * away), so the chat never shows a raw error.
 */

export type ChatMessage = { role: 'user' | 'assistant'; text: string }
export type Handoff = { category: SupportCategory; summary: string; orderNumber?: string }

export type AssistantReply = {
  text: string
  /** Set when the concierge handed over: the widget raises "Write to the
   *  team" with the category, the order and the summary pre-filled. */
  handoff?: Handoff
  /** Products the reply links to, as cards built from the catalogue. */
  products: ProductCard[]
}

export type AnswerOutcome =
  | { ok: true; reply: AssistantReply; metrics: TurnMetrics }
  | { ok: false; reason: FallbackReason; metrics: TurnMetrics }

/**
 * gemini-3.8-flash: the stable (GA, 2026-09-02) Flash model, with function
 * calling and the LOW thinking level this uses ("minimal" is refused by 3.8).
 * gemini-3.6-flash, the previous default, has a retirement date of
 * 2026-11-19 on Google Cloud. GEMINI_MODEL overrides it, as before.
 */
export const DEFAULT_MODEL = 'gemini-3.8-flash'

export const LIMITS = {
  totalMs: 20_000,
  maxRounds: 4,
  maxCallsPerRound: 4,
  maxCalls: 8,
  /** 3.x Flash spends part of this on its thinking (see the measurement in
   *  lib/server/stylist/rationale.ts). At 700–1 024 a longer turn could stop
   *  with MAX_TOKENS before writing anything, and the customer got a
   *  template. The reply's own length is bounded by the prompt and by
   *  REPLY_MAX_CHARS, so this is headroom, not a longer answer. */
  maxOutputTokens: 4096,
  toolResponseChars: 6000,
  maxCards: 3,
} as const

/**
 * When the main model is overloaded (Google answers 503 "high demand") or
 * does not answer in time, the turn moves to this one instead of failing:
 * seen in production on 2026-10-15, where every turn of gemini-3.8-flash got
 * 503 or ran out of time and the customer only saw a fallback.
 * GEMINI_FALLBACK_MODEL overrides it; "off" disables the fallback.
 */
export const FALLBACK_MODEL = 'gemini-3.6-flash'
/** A main-model call that has not answered by then is presumed overloaded
 *  and handed to the fallback model, leaving it the rest of the budget. */
export const PRIMARY_CALL_MS = 10_000

let warnedModel = ''

/**
 * The model to call. GEMINI_MODEL is shared with search, the stylist and
 * translation, which pass it to the SDK as written, so it is read the same
 * forgiving way here: "models/…", quotes and spaces are accepted. A value
 * that still cannot be a model name is IGNORED with a warning — it used to
 * switch the concierge off, silently, while the other features kept working.
 */
function cleanModel(value: string | undefined): string {
  return (value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim().replace(/^models\//, '')
}

/** The model a turn moves to when the main one is overloaded, or null when
 *  there is none (switched off, or the same as the main model). */
export function fallbackModelName(): string | null {
  const raw = cleanModel(process.env.GEMINI_FALLBACK_MODEL)
  if (raw.toLowerCase() === 'off') return null
  const name = raw && /^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(raw) ? raw : FALLBACK_MODEL
  return name === modelName() ? null : name
}

export function modelName(): string {
  const raw = cleanModel(process.env.GEMINI_MODEL)
  if (!raw) return DEFAULT_MODEL
  if (/^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(raw)) return raw
  if (warnedModel !== raw) {
    warnedModel = raw
    console.warn(`[assistant] GEMINI_MODEL is not a model name; using ${DEFAULT_MODEL} instead.`)
  }
  return DEFAULT_MODEL
}

/** Whether the concierge is on, and if not, why — reasons only, no values. */
export type AssistantStatus = { on: true } | { on: false; reason: 'no_key' | 'disabled' }

export function assistantStatus(): AssistantStatus {
  if (!process.env.GEMINI_API_KEY?.trim()) return { on: false, reason: 'no_key' }
  if (process.env.SUPPORT_ASSISTANT_AI === 'off') return { on: false, reason: 'disabled' }
  return { on: true }
}

export function isAssistantConfigured(): boolean {
  return assistantStatus().on
}

// ------------------------------------------------------------ the model --

export type ModelRequest = { system: string; contents: Content[]; tools: boolean; signal: AbortSignal }
export type ModelCall = { id?: string; name: string; args: unknown }
export type ModelResponse = { text: string; calls: ModelCall[]; finishReason?: string; content?: Content }
export type Generate = (req: ModelRequest) => Promise<ModelResponse>

function geminiGenerate(key: string, model: string): Generate {
  const ai = geminiClient(key)
  return async ({ system, contents, tools, signal }) => {
    const res = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: system,
        tools: tools ? [{ functionDeclarations: TOOLS }] : undefined,
        temperature: 0.3,
        maxOutputTokens: LIMITS.maxOutputTokens,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: signal,
      },
    })
    const candidate = res.candidates?.[0]
    const calls = (res.functionCalls ?? []).map((c) => ({ id: c.id, name: c.name ?? '', args: c.args }))
    let text = ''
    if (calls.length === 0) {
      try {
        text = res.text ?? ''
      } catch {
        text = ''
      }
    }
    return { text, calls, finishReason: candidate?.finishReason, content: candidate?.content }
  }
}

/** Status of a provider error, when there is one. */
function statusOf(e: unknown): number | null {
  if (e instanceof ApiError) return e.status
  const s = (e as { status?: unknown })?.status
  return typeof s === 'number' ? s : null
}

// ---------------------------------------------------------- dependencies --

export type AnswerDeps = {
  generate: Generate
  /** The fallback model, used when the main one is overloaded or slow. */
  fallback?: Generate
  fallbackModel?: string
  /** How long a main-model call may take before the fallback answers
   *  instead; PRIMARY_CALL_MS unless a test shortens it. */
  primaryCallMs?: number
  userId: () => Promise<string | null>
  orders: (credentials: OrderCredential[], userId: string | null) => Promise<Order[]>
  catalog: () => Promise<Catalog>
  keywordSearch: KeywordSearch
  shipping: () => Promise<ShippingSettings>
  now: () => Date
  model: string
  /** The turn's time budget; LIMITS.totalMs unless a test shortens it. */
  timeoutMs?: number
}

async function postgresKeywordSearch(query: string): Promise<string[]> {
  const { data, error } = await createAdminClient().rpc('search_products', { p_query: query.slice(0, 60), p_limit: 12 })
  if (error) throw new Error(error.message)
  return ((data ?? []) as { slug: string }[]).map((r) => r.slug)
}

function defaultDeps(): AnswerDeps | null {
  const key = process.env.GEMINI_API_KEY?.trim()
  const model = modelName()
  if (!key || !isAssistantConfigured()) return null
  const fallbackModel = fallbackModelName()
  return {
    generate: geminiGenerate(key, model),
    ...(fallbackModel ? { fallback: geminiGenerate(key, fallbackModel), fallbackModel } : {}),
    userId: () =>
      getCurrentUser()
        .then((user) => user?.id ?? null)
        .catch(() => null),
    orders: requesterOrders,
    catalog: readCatalog,
    keywordSearch: postgresKeywordSearch,
    shipping: getShippingSettings,
    now: () => new Date(),
    model,
  }
}

// --------------------------------------------------------------- answer --

/** Keeps a tool result small enough for the model: lists are shortened
 *  before anything is cut. */
export function capResponse(value: Record<string, unknown>, max: number = LIMITS.toolResponseChars): Record<string, unknown> {
  let json = JSON.stringify(value)
  if (json.length <= max) return value
  const copy: Record<string, unknown> = { ...value }
  for (const key of ['results', 'products', 'orders']) {
    const list = copy[key]
    if (!Array.isArray(list)) continue
    const items = [...list]
    while (items.length > 1 && JSON.stringify({ ...copy, [key]: items }).length > max) items.pop()
    copy[key] = items
    copy.truncated = true
  }
  json = JSON.stringify(copy)
  return json.length <= max ? copy : { error: 'result_too_large' }
}

export async function answer(
  opts: {
    locale: StorefrontLocale
    messages: ChatMessage[]
    credentials: OrderCredential[]
    /** The product page the chat was opened on — an id, resolved here. */
    productContext?: string
    signal?: AbortSignal
  },
  injected?: Partial<AnswerDeps>,
): Promise<AnswerOutcome> {
  const started = Date.now()
  const metrics = emptyMetrics()
  const base = defaultDeps()
  const model = injected?.model ?? base?.model ?? modelName()
  /** The model that actually answered: the fallback's, once it took over. */
  let usedModel = model

  function finish(outcome: AnswerOutcome): AnswerOutcome {
    outcome.metrics.ms = Date.now() - started
    if (outcome.ok) {
      outcome.metrics.handoff = Boolean(outcome.reply.handoff)
      outcome.metrics.products = outcome.reply.products.length
      assistantEvent({ event: 'answered', locale: opts.locale, model: usedModel, metrics: outcome.metrics })
    } else {
      assistantEvent({ event: 'fallback', locale: opts.locale, model: usedModel, reason: outcome.reason, metrics: outcome.metrics })
    }
    return outcome
  }

  if (!base && !injected?.generate) return finish({ ok: false, reason: 'unconfigured', metrics })
  // Tests inject what they exercise; anything else defaults to "nothing
  // there" rather than to a live service.
  const offline: Omit<AnswerDeps, 'generate'> = {
    userId: async () => null,
    orders: async () => [],
    catalog: async () => {
      throw new Error('catalogue not available')
    },
    keywordSearch: async () => [],
    shipping: async () => DEFAULT_SHIPPING_SETTINGS,
    now: () => new Date(),
    model,
  }
  const deps = { ...offline, ...(base ?? {}), ...injected } as AnswerDeps

  // One controller for the whole turn: the time budget and the customer
  // closing the widget both stop whatever call is running.
  const controller = new AbortController()
  let stopped: 'timeout' | 'cancelled' | null = null
  const budget = injected?.timeoutMs ?? LIMITS.totalMs
  const timer = setTimeout(() => {
    stopped ??= 'timeout'
    controller.abort()
  }, budget)
  const onCancel = () => {
    stopped ??= 'cancelled'
    controller.abort()
  }
  if (opts.signal?.aborted) onCancel()
  opts.signal?.addEventListener('abort', onCancel, { once: true })


  // Loaded once, and only when a tool or the reply needs them.
  let ordersPromise: Promise<Order[]> | null = null
  let userIdPromise: Promise<string | null> | null = null
  const userId = () => (userIdPromise ??= deps.userId())
  const loadOrders = async () => (ordersPromise ??= deps.orders(opts.credentials, await userId()))
  let catalogPromise: Promise<Catalog> | null = null
  const loadCatalog = () => (catalogPromise ??= deps.catalog())

  const shown = new Map<string, Product>()
  let handoff: Handoff | undefined
  const evidence: Evidence = { catalogIds: new Set(), toolUrls: new Set(), amounts: new Set() }
  const cache = new Map<string, Record<string, unknown>>()
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')?.text ?? ''

  async function runTool(call: ValidArgs, shipping: ShippingSettings): Promise<Record<string, unknown>> {
    switch (call.name) {
      case 'search_products': {
        const catalog = await loadCatalog()
        const found = await searchCatalog(catalog, call.args, opts.locale, deps.keywordSearch)
        for (const p of found.products) shown.set(p.id, p)
        if (!found.results.length) {
          return { results: [], totalMatches: 0, note: 'No product matches. Do not suggest products that were not returned.' }
        }
        return {
          results: found.results,
          totalMatches: found.total,
          ...(found.relaxed.length
            ? {
                loosened: found.relaxed,
                note: 'Nothing matched the whole request; these meet its firm requirements (colour, category, price, size, where given) but not every word. Present them as the closest pieces, not an exact match.',
              }
            : {}),
        }
      }
      case 'get_product': {
        const catalog = await loadCatalog()
        const p = findProduct(catalog, call.args.productId)
        if (!p) return { error: 'not_found', note: 'No product with this id. Search instead.' }
        shown.set(p.id, p)
        return { product: detail(catalog, p, opts.locale, shipping.deliveryTimeframe) }
      }
      case 'compare_products': {
        const catalog = await loadCatalog()
        const found = call.args.productIds.map((id) => findProduct(catalog, id)).filter((p): p is Product => Boolean(p))
        for (const p of found) shown.set(p.id, p)
        const missing = call.args.productIds.filter((id) => !found.some((p) => p.id === id))
        return {
          products: found.map((p) => detail(catalog, p, opts.locale, shipping.deliveryTimeframe)),
          ...(missing.length ? { notFound: missing } : {}),
        }
      }
      case 'get_order_status': {
        const mine = await loadOrders()
        const order = mine.find((o) => o.id === call.args.orderNumber)
        // Never whether that order exists — only that it is not this
        // requester's to see.
        return order ? { order: orderForAssistant(order) } : { error: 'not_visible', orderNumber: call.args.orderNumber }
      }
      case 'list_my_orders': {
        const mine = await loadOrders()
        return { orders: mine.slice(0, 5).map(orderSummary), count: mine.length }
      }
      case 'offer_human_support': {
        const summary = call.args.summary || redactPersonalData(lastUser).slice(0, 600)
        handoff = { category: call.args.category, summary, ...(call.args.orderNumber ? { orderNumber: call.args.orderNumber } : {}) }
        return { ok: true, shown: 'A "Write to the team" button with this summary, which the customer reviews and sends. Nothing has been sent yet.' }
      }
    }
  }

  try {
    if (stopped) return finish({ ok: false, reason: stopped, metrics })
    const shipping = await deps.shipping()
    const signedIn = (await userId()) !== null

    let context: string | undefined
    if (opts.productContext) {
      try {
        const catalog = await loadCatalog()
        const p = findProduct(catalog, opts.productContext)
        if (p) {
          shown.set(p.id, p)
          context = JSON.stringify(summarize(catalog, p, opts.locale))
        }
      } catch {
        // The page context is a convenience; the conversation works without it.
      }
    }

    const knowledge = knowledgeFor(opts.locale, shipping)
    for (const a of amountsIn(knowledge)) evidence.amounts.add(a)
    const language = expectedLanguage(lastUser, opts.locale)
    // Only a message long and clear enough to classify fixes the language.
    // A short one ("Any black coats?") leaves the model free to answer in the
    // customer's own language — which used to be rejected as "wrong" and
    // replaced by the help centre's prepared answer.
    const languageSure = detectLanguage(lastUser) === language
    const system = systemPrompt({
      locale: opts.locale,
      answerIn: language,
      languageSure,
      today: deps.now().toISOString().slice(0, 10),
      signedIn,
      replyWithin: describeBusinessDays(FULFILMENT.supportReply, opts.locale, { genitive: true }),
      knowledge,
      productContext: context,
    })

    const contents: Content[] = opts.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.role === 'user' ? redactPersonalData(m.text) : m.text }],
    }))

    // Once the main model has failed this turn, every later call goes
    // straight to the fallback: it is overloaded now, not in a second.
    let onFallback = false
    const generate = async (tools: boolean): Promise<ModelResponse> => {
      const request = (signal: AbortSignal) => ({ system, contents, tools, signal })
      if (onFallback && deps.fallback) return deps.fallback(request(controller.signal))
      // The main model gets its own deadline when there is a fallback to
      // turn to, so a slow model leaves time for an answer.
      const attempt = new AbortController()
      const relay = () => attempt.abort()
      controller.signal.addEventListener('abort', relay, { once: true })
      let slow = false
      const deadline = deps.fallback
        ? setTimeout(() => {
            slow = true
            attempt.abort()
          }, deps.primaryCallMs ?? PRIMARY_CALL_MS)
        : undefined
      try {
        return await deps.generate(request(attempt.signal))
      } catch (e) {
        if (stopped) throw e
        const status = statusOf(e)
        if (status !== null) metrics.providerStatus = status
        const overloaded = slow || status === 429 || (status !== null && status >= 500)
        if (overloaded && deps.fallback) {
          onFallback = true
          metrics.modelFallback = true
          if (deps.fallbackModel) usedModel = deps.fallbackModel
          return deps.fallback(request(controller.signal))
        }
        // No fallback: one retry, for a provider-side failure, when the
        // budget allows.
        if (status !== null && status >= 500 && Date.now() - started < budget - Math.min(8000, budget / 2)) {
          await new Promise((r) => setTimeout(r, 400))
          return deps.generate(request(controller.signal))
        }
        throw e
      } finally {
        if (deadline) clearTimeout(deadline)
        controller.signal.removeEventListener('abort', relay)
      }
    }

    let res: ModelResponse | null = null
    for (let round = 0; round <= LIMITS.maxRounds; round++) {
      metrics.rounds = round + 1
      // After the last allowed round the model must answer in words.
      res = await generate(round < LIMITS.maxRounds && metrics.toolCalls < LIMITS.maxCalls)
      if (res.calls.length === 0) break
      if (!res.content) {
        metrics.finishReason = 'NO_CONTENT'
        return finish({ ok: false, reason: 'invalid_response', metrics })
      }

      contents.push(res.content)
      const parts: Content['parts'] = []
      for (let i = 0; i < res.calls.length; i++) {
        const call = res.calls[i]
        let response: Record<string, unknown>
        if (i >= LIMITS.maxCallsPerRound || metrics.toolCalls >= LIMITS.maxCalls) {
          metrics.rejectedCalls++
          response = { error: 'tool_limit', note: 'Answer with what you already have.' }
        } else {
          const valid = validateCall(call.name, call.args)
          if (isInvalid(valid)) {
            metrics.rejectedCalls++
            response = { ...valid }
          } else {
            metrics.toolCalls++
            metrics.tools[valid.name] = (metrics.tools[valid.name] ?? 0) + 1
            const key = `${valid.name}:${JSON.stringify(valid.args)}`
            const cached = cache.get(key)
            if (cached) {
              response = { ...cached, note: 'Same call as before; same result.' }
            } else {
              try {
                response = capResponse(await runTool(valid, shipping))
              } catch (e) {
                if (stopped) throw e
                console.warn(`[assistant] tool ${valid.name} failed:`, (e as Error).message)
                response = { error: 'temporarily_unavailable', note: 'Say you cannot check this right now and offer the team.' }
              }
              cache.set(key, response)
              collectEvidence(response, evidence)
            }
          }
        }
        parts.push({ functionResponse: { id: call.id, name: call.name || 'unknown', response } })
      }
      contents.push({ role: 'user', parts })
    }

    const done = (r: ModelResponse | null) => Boolean(r && r.calls.length === 0 && r.text.trim() && (!r.finishReason || r.finishReason === FinishReason.STOP))
    // Why a reply could not be used, for the log: MAX_TOKENS, SAFETY, an
    // empty text, or tools still being called after the last round.
    const why = (r: ModelResponse | null) =>
      !r ? 'NONE' : r.calls.length ? 'TOOL_CALL' : r.finishReason && r.finishReason !== FinishReason.STOP ? String(r.finishReason) : 'EMPTY'
    if (!done(res)) {
      metrics.finishReason = why(res)
      return finish({ ok: false, reason: 'invalid_response', metrics })
    }
    let text = res!.text

    // The language the customer wrote in (or the page's). One rewrite, then
    // the prepared answers rather than a reply they may not read.
    const wrong = (t: string) => {
      if (!languageSure) return false
      const lang = detectLanguage(t)
      return lang !== null && lang !== language
    }
    if (wrong(text)) {
      metrics.languageRetry = true
      contents.push({ role: 'model', parts: [{ text }] })
      contents.push({
        role: 'user',
        parts: [{ text: `(Note from the shop's system, not the customer: rewrite your previous reply in ${LANGUAGE_NAME[language]}, with the same content.)` }],
      })
      const again = await generate(false)
      if (!done(again) || wrong(again.text)) {
        if (!done(again)) metrics.finishReason = why(again)
        return finish({ ok: false, reason: 'wrong_language', metrics })
      }
      text = again.text
    }

    // Links are checked against the catalogue: load it if the reply names a
    // product page and no tool needed it.
    if (/\/product\//i.test(text)) {
      try {
        for (const p of (await loadCatalog()).products) evidence.catalogIds.add(p.id)
      } catch {
        // Without the catalogue no product link can be verified: all go.
      }
    }
    const checked = checkReply(text, evidence)
    if (!checked) {
      metrics.finishReason = 'EMPTY_AFTER_CHECK'
      return finish({ ok: false, reason: 'invalid_response', metrics })
    }
    metrics.removedLinks = checked.removedLinks
    metrics.unverifiedAmounts = checked.unverifiedAmounts

    const catalog = catalogPromise ? await catalogPromise.catch(() => null) : null
    const products = checked.linkedProducts
      .map((id) => shown.get(id) ?? (catalog ? findProduct(catalog, id) : null))
      .filter((p): p is Product => Boolean(p))
      .slice(0, LIMITS.maxCards)
      .map((p) => card(p, opts.locale))

    return finish({ ok: true, reply: { text: checked.text, handoff, products }, metrics })
  } catch (e) {
    if (stopped) return finish({ ok: false, reason: stopped, metrics })
    const status = statusOf(e)
    // The HTTP status goes into the structured log line: 404 means the model
    // name is not available to this key, 400/403 the key or the request.
    if (status !== null) metrics.providerStatus = status
    if (status === 429) return finish({ ok: false, reason: 'rate_limited', metrics })
    // The provider's message stays in the log, never in the answer.
    console.warn('[assistant] answer skipped:', status ?? '', (e as Error).message?.slice(0, 200))
    return finish({ ok: false, reason: 'provider_error', metrics })
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onCancel)
  }
}
