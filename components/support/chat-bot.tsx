'use client'

import { ArrowLeft, ArrowRight, Bot, RotateCcw, Send, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { readOrderRegistry } from '@/lib/order-registry'
import { productImage } from '@/lib/product-image'
import { SITE_ORIGIN } from '@/lib/site-origin'
import { FAQ, searchFaq, type FaqEntry } from '@/lib/support/faq'
import { SUPPORT_COPY, SUPPORT_TOPICS, TOPIC_CATEGORY, fill, type SupportTopic } from '@/lib/support/copy'
import { formatPrice, useStore } from '@/lib/store'
import type { Locale, SupportCategory } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PrivacyNotice } from '@/components/privacy-notice'

/**
 * The concierge behind the floating button, bottom right.
 *
 * TWO MODES, ONE WIDGET.
 *
 *   AI — free text goes to /api/support/assistant: a model that answers from
 *   the shop's own policies, the live catalogue and the customer's own orders
 *   (see lib/server/assistant/), and hands over to a person when it cannot.
 *   Products it recommends arrive as cards built by the server from the
 *   catalogue — the price and availability on a card are never the model's.
 *
 *   Help centre — when the concierge is off, or fails for one question, the
 *   reply is an answer already written for the help centre
 *   (lib/support/faq.ts), with the live shipping figures filled in. A failure
 *   never loses the question: it is offered as the request to the team.
 *
 * BUTTONS COLLECT, THEN ASK. The order topics — "Where is my order?",
 * "Returns" — ask for the order number (offering the customer's own orders as
 * one-tap choices), check its shape here, and then put the full question to
 * the concierge. The other topics offer their prepared questions, answered
 * instantly and exactly, without a model call.
 *
 * ONE REQUEST AT A TIME, CANCELLABLE. A question cannot be sent twice while
 * one is on its way; closing the panel aborts the request (and the server
 * stops the model call with it); a failed request offers "Try again" and
 * "Write to the team" with the question kept.
 *
 * THE CONVERSATION STAYS FOR THE TAB, not the page: sessionStorage under
 * `lv.concierge`, for at most two hours, cleared by "New conversation" — and
 * listed in the cookie policy. It holds the messages only; the browser's
 * order tokens stay in their own registry and are read at send time.
 */

type Handoff = { category: SupportCategory; summary: string; orderNumber?: string }
type ProductCard = {
  id: string
  name: string
  price: number
  oldPrice?: number
  image: string
  path: string
  stock: 'in_stock' | 'sold_out' | 'not_tracked'
}

type Message = {
  id: string
  from: 'bot' | 'user'
  text: string
  /** What the model reads for this turn, when it differs from what is shown
   *  ("LV-7K2M9Q" shown, "Where is my order LV-7K2M9Q?" asked). */
  asked?: string
  handoff?: Handoff
  products?: ProductCard[]
  /** An AI answer: can be rated. */
  turnId?: string
  rated?: boolean
  /** A failed request, with what to send again. */
  retry?: { question: string; shown?: string }
}

/** An order-number question the widget is collecting. */
type Slot = 'where' | 'returns'

const STORE_KEY = 'lv.concierge'
const STORE_TTL_MS = 2 * 60 * 60 * 1000
const MAX_SAVED = 60

let seq = 0
const nextId = () => `m${Date.now().toString(36)}${++seq}`

/** Instant answers still get a moment of "typing": a reply that lands in the
 *  same frame as the question reads as canned. */
const TYPING_MS = 450
/** After this, the typing dots say that the concierge is still working. */
const SLOW_MS = 7000

/** Same rule as the server (lib/server/assistant/orders.ts). Only read
 *  while an order number has just been asked for: numbers can be all letters
 *  (lib/server/order-drafts.ts), so outside that question a six-letter word
 *  would look like one. */
function orderNumber(raw: string): string | null {
  const match = /^(?:LV-?)?([A-Z0-9]{6})$/.exec(raw.toUpperCase().replace(/[#\s№]/g, ''))
  return match ? `LV-${match[1]}` : null
}

/** The product page this chat is open on, if any — an id the server looks
 *  up for itself. Nothing else about the page is sent. */
function productOnPage(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const m = /^\/(?:(?:it|fr|de)\/)?product\/([a-z0-9][a-z0-9-]{0,99})\/?$/i.exec(window.location.pathname)
  return m ? m[1].toLowerCase() : undefined
}

function isMessage(m: unknown): m is Message {
  const x = m as Message
  return Boolean(x) && typeof x.id === 'string' && (x.from === 'bot' || x.from === 'user') && typeof x.text === 'string' && x.text.length < 4000
}

function loadSaved(): { messages: Message[]; topic: SupportTopic | null; aboutOrder?: string } | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { at?: number; messages?: unknown[]; topic?: unknown; aboutOrder?: unknown }
    if (typeof saved.at !== 'number' || Date.now() - saved.at > STORE_TTL_MS || !Array.isArray(saved.messages)) {
      window.sessionStorage.removeItem(STORE_KEY)
      return null
    }
    // Cards are links: checked again on the way back, as when they arrived.
    const messages = saved.messages
      .filter(isMessage)
      .slice(-MAX_SAVED)
      .map((m) => (m.products ? { ...m, products: readProducts(m.products) } : m))
    if (messages.length === 0) return null
    return {
      messages,
      topic: SUPPORT_TOPICS.indexOf(saved.topic as SupportTopic) !== -1 ? (saved.topic as SupportTopic) : null,
      aboutOrder: typeof saved.aboutOrder === 'string' ? orderNumber(saved.aboutOrder) ?? undefined : undefined,
    }
  } catch {
    return null
  }
}

function save(messages: Message[], topic: SupportTopic | null, aboutOrder?: string) {
  try {
    window.sessionStorage.setItem(
      STORE_KEY,
      JSON.stringify({ at: Date.now(), messages: messages.slice(-MAX_SAVED), topic, aboutOrder }),
    )
  } catch {
    // Storage unavailable (private mode, quota): the chat simply does not
    // outlive the page.
  }
}

/** Server products, checked for shape before they are rendered. */
function readProducts(value: unknown): ProductCard[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (p): p is ProductCard =>
        Boolean(p) &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.price === 'number' &&
        typeof p.path === 'string' &&
        p.path.startsWith('/') &&
        !p.path.startsWith('//'),
    )
    .slice(0, 3)
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/g

/**
 * The reply as text, with its http(s) links made clickable — and nothing
 * else: no HTML is ever interpreted. The shop's own links open in the same
 * tab (and on this host, so a preview stays a preview); any other link — the
 * server only lets tracking links through — in a new one.
 */
function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of Array.from(text.matchAll(URL_IN_TEXT))) {
    const found = match[0]
    const url = found.replace(/[.,;:!?]+$/, '')
    const start = match.index ?? 0
    parts.push(text.slice(last, start))
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      parsed = null
    }
    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      parts.push(url)
    } else {
      const own = parsed.origin === SITE_ORIGIN || parsed.origin === window.location.origin
      const label = `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
      parts.push(
        own ? (
          <Link key={start} href={`${parsed.pathname}${parsed.search}${parsed.hash}`} className="text-gold underline-offset-2 hover:underline">
            {label}
          </Link>
        ) : (
          <a key={start} href={parsed.href} target="_blank" rel="noopener noreferrer nofollow" className="text-gold underline-offset-2 hover:underline">
            {label}
          </a>
        ),
      )
    }
    parts.push(found.slice(url.length))
    last = start + found.length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

/**
 * A second pass for free text, used only in help-centre mode when its own
 * search finds nothing.
 *
 * searchFaq requires EVERY word to appear, which is right for a search box and
 * too strict for a sentence someone types at a bot. This ranks entries by how
 * many of the words they do match, comparing on the first five characters so
 * inflected endings still line up. What it returns are SUGGESTIONS, offered as
 * questions to tap — never posted as though the bot had understood.
 */
function relatedQuestions(locale: Locale, query: string, answerOf: (e: FaqEntry) => string): FaqEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  if (words.length === 0) return []
  return FAQ.map((entry) => {
    const hay = `${entry.q[locale]} ${answerOf(entry)}`.toLowerCase()
    const score = words.reduce((n, w) => n + (hay.indexOf(w.slice(0, 5)) !== -1 ? 1 : 0), 0)
    return { entry, score }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.entry)
}

export function ChatBot() {
  const { t, locale, panel, setPanel, openSupport, shipping } = useStore()
  const open = panel === 'chat'
  const c = SUPPORT_COPY[locale]

  const [messages, setMessages] = useState<Message[]>([])
  const [topic, setTopic] = useState<SupportTopic | null>(null)
  /** Near misses from free text, offered as questions rather than answers. */
  const [suggestions, setSuggestions] = useState<FaqEntry[]>([])
  const [query, setQuery] = useState('')
  /** null until the server has said whether the concierge is on. */
  const [ai, setAi] = useState<boolean | null>(null)
  const [typing, setTyping] = useState(false)
  const [slow, setSlow] = useState(false)
  const [slot, setSlot] = useState<Slot | null>(null)
  /** The customer's own order numbers, offered while a slot is open. */
  const [myOrders, setMyOrders] = useState<string[]>([])
  /** The order the conversation is about, for a hand-over. */
  const [aboutOrder, setAboutOrder] = useState<string | undefined>()
  const [onProduct, setOnProduct] = useState<string | undefined>()
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** The conversation as the server should read it — kept in a ref so a
   *  reply never races a stale copy of the state. */
  const history = useRef<Message[]>([])
  /** The request on its way, if any: one at a time, aborted on close. */
  const inflight = useRef<AbortController | null>(null)
  const timers = useRef<number[]>([])

  // The same figures the help centre fills its answers with — read from the
  // admin's live shipping settings, never hardcoded here.
  const faqVars = useMemo(
    () => ({
      span: describeBusinessDays(shipping.deliveryTimeframe, locale),
      price: formatPrice(shipping.shippingPrice, true),
      amount: formatPrice(shipping.freeShippingThreshold),
      returnDays: FULFILMENT.returnWindowDays,
      refund: describeBusinessDays(FULFILMENT.refund, locale),
      reply: describeBusinessDays(FULFILMENT.supportReply, locale, { genitive: true }),
    }),
    [shipping, locale],
  )
  const answerOf = useMemo(() => (e: FaqEntry) => fill(e.a[locale], faqVars), [locale, faqVars])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const stopAll = useCallback(() => {
    inflight.current?.abort()
    inflight.current = null
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
    setTyping(false)
    setSlow(false)
  }, [])

  const greet = useCallback(() => {
    const greeting: Message = { from: 'bot', text: t('chat.greeting'), id: nextId() }
    history.current = [greeting]
    setMessages([greeting])
    setTopic(null)
    setSuggestions([])
    setSlot(null)
    setAboutOrder(undefined)
  }, [t])

  // Opening: the conversation of this tab if there is one, else a greeting;
  // the product page, if any; and once, whether the concierge is on.
  useEffect(() => {
    if (!open) return
    setOnProduct(productOnPage())
    if (history.current.length === 0) {
      const saved = loadSaved()
      if (saved) {
        history.current = saved.messages
        setMessages(saved.messages)
        setTopic(saved.topic)
        setAboutOrder(saved.aboutOrder)
      } else {
        greet()
      }
    }
    // The field, ready to type into.
    window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50)
    if (ai !== null) return
    let cancelled = false
    // Only the server's own answer can switch the concierge off. A failed
    // check (a network blip, an edge challenge, a cold start) leaves it
    // unknown, so questions still go to the concierge — which says
    // 'unconfigured' itself if it really is off. It used to switch the chat
    // to prepared answers for the whole visit, without asking the model once.
    fetch('/api/support/assistant')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ai?: unknown } | null) => {
        if (!cancelled && typeof d?.ai === 'boolean') setAi(d.ai)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, ai, greet])

  // The chat stays open across pages (a product card in it was tapped): the
  // "about this piece" offer follows the page.
  const pathname = usePathname()
  useEffect(() => {
    if (open) setOnProduct(productOnPage())
  }, [open, pathname])

  // Closing (or leaving the page) stops what is on its way.
  useEffect(() => {
    if (!open) stopAll()
  }, [open, stopAll])
  useEffect(() => stopAll, [stopAll])

  // The conversation outlives a page change, for this tab.
  useEffect(() => {
    if (messages.length > 1) save(messages, topic, aboutOrder)
  }, [messages, topic, aboutOrder])

  // Every new message, and the typing dots, scroll into view.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing, slow])

  const close = useCallback(() => {
    setPanel(null)
    // Back to the button that opened it (it reappears once the panel is gone).
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-chat-launcher]')?.focus(), 30)
  }, [setPanel])

  if (!open) return null

  const push = (message: Omit<Message, 'id'>) => {
    const next = { ...message, id: nextId() }
    history.current = [...history.current, next]
    setMessages(history.current)
  }

  /** A prepared reply, after a short beat of typing. */
  const reply = (message: Omit<Message, 'id' | 'from'>, after?: () => void) => {
    setTyping(true)
    later(() => {
      setTyping(false)
      push({ from: 'bot', ...message })
      after?.()
    }, TYPING_MS)
  }

  /** Help-centre mode: the prepared answers only — a hit is answered, a near
   *  miss is offered as questions, a total miss offers a person with the
   *  question kept. `note` says the concierge was unavailable this time. */
  function answerFromHelpCentre(text: string, note = false) {
    // Every reply in this mode says so when the concierge was meant to
    // answer: a prepared answer must never pass for the model's.
    const prefix = note ? `${t('chat.fallbackNote')}\n\n` : ''
    const hits = searchFaq(FAQ, locale, text, answerOf)
    if (hits.length > 0) return reply({ text: prefix + answerOf(hits[0]) }, () => setSuggestions(hits.slice(1, 4)))
    const near = relatedQuestions(locale, text, answerOf)
    if (near.length > 0) return reply({ text: prefix + t('chat.maybe') }, () => setSuggestions(near))
    reply(
      { text: prefix + t('chat.noAnswer'), handoff: { category: topic ? TOPIC_CATEGORY[topic] : 'other', summary: text.slice(0, 600) } },
      () => setSuggestions([]),
    )
  }

  /** Sends a question to the concierge. The customer's message is already
   *  on screen (by ask(), or still there for a retry). */
  async function send(question: string) {
    if (inflight.current) return
    const controller = new AbortController()
    inflight.current = controller
    setTyping(true)
    setSlow(false)
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS)
    let res: Response | null = null
    let data: unknown = null
    try {
      res = await fetch('/api/support/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          locale,
          messages: history.current
            .filter((m) => !m.retry)
            .map((m) => ({ role: m.from === 'bot' ? 'assistant' : 'user', text: m.asked ?? m.text })),
          orders: readOrderRegistry(),
          context: productOnPage() ? { productId: productOnPage() } : undefined,
        }),
      })
      data = await res.json().catch(() => null)
    } catch {
      // Aborted (closed) or the network failed.
    } finally {
      window.clearTimeout(slowTimer)
    }
    // Closed meanwhile: nothing to show, and no one to show it to.
    if (controller.signal.aborted) return
    inflight.current = null
    setTyping(false)
    setSlow(false)

    const body = data as
      | { mode: 'ai'; reply: string; handoff?: Handoff; products?: unknown; turnId?: string }
      | { mode: 'fallback'; reason?: string }
      | null
    if (res?.ok && body?.mode === 'ai' && typeof body.reply === 'string' && body.reply.trim()) {
      push({
        from: 'bot',
        text: body.reply,
        handoff: body.handoff,
        products: readProducts(body.products),
        turnId: typeof body.turnId === 'string' ? body.turnId : undefined,
      })
      return
    }
    if (res?.ok && body?.mode === 'fallback') {
      // Off for good: the help centre from now on. Anything else is this
      // question only — the next one tries the concierge again.
      if (body.reason === 'unconfigured') setAi(false)
      return answerFromHelpCentre(question, body.reason !== 'unconfigured')
    }
    push({
      from: 'bot',
      text: res?.status === 429 ? t('chat.tooMany') : t('chat.error'),
      retry: { question },
    })
  }

  /** Puts a question to the concierge. `shown` is what the customer sees as
   *  their message, when the question itself was built by the widget. */
  function ask(question: string, shown?: string) {
    if (inflight.current || typing) return
    setSuggestions([])
    setSlot(null)
    push({ from: 'user', text: shown ?? question, asked: shown ? question : undefined })
    if (ai === false) return answerFromHelpCentre(question)
    void send(question)
  }

  function retry(message: Message) {
    if (!message.retry || inflight.current) return
    // The failed notice goes; the question is still the last thing asked.
    history.current = history.current.filter((m) => m.id !== message.id)
    setMessages(history.current)
    void send(message.retry.question)
  }

  /** The customer's own orders, as one-tap answers to "which order?". */
  function loadMyOrders() {
    fetch('/api/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: readOrderRegistry() }),
    })
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((d: { orders?: { id: string }[] }) => setMyOrders((d.orders ?? []).slice(0, 4).map((o) => o.id)))
      .catch(() => setMyOrders([]))
  }

  function pickTopic(next: SupportTopic) {
    push({ from: 'user', text: c.topics[next] })
    setTopic(next)
    setSuggestions([])
    // Order topics collect the order first — with the concierge on.
    if (ai !== false && (next === 'where' || next === 'returns')) {
      setSlot(next)
      setMyOrders([])
      loadMyOrders()
      reply({ text: t(next === 'where' ? 'chat.askOrder' : 'chat.askReturnOrder') }, () => inputRef.current?.focus())
      return
    }
    setSlot(null)
    reply({ text: t('chat.topicIntro') })
  }

  function pickQuestion(entry: FaqEntry) {
    push({ from: 'user', text: entry.q[locale] })
    setSuggestions([])
    reply({ text: answerOf(entry) })
  }

  /** An order number for the open slot: the full question goes to the
   *  concierge, the customer sees just the number they gave. */
  function fillSlot(which: Slot, number: string) {
    setAboutOrder(number)
    ask(t(which === 'where' ? 'chat.whereIs' : 'chat.returnOrder').replace('{n}', number), number)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = query.trim()
    if (!text || typing || inflight.current) return
    setQuery('')
    if (slot) {
      const number = orderNumber(text)
      if (number) return fillSlot(slot, number)
      // Something that looks like an attempt at a number ("LV12", "7K2M") is a
      // typo: ask again without a model call. Anything else ("Non so", "I
      // don't have it") is the customer talking: the concierge reads it.
      const compact = text.replace(/\s+/g, '')
      if (/^#?(?:lv-?)?[a-z0-9]{1,12}$/i.test(compact) && /\d|^#?lv/i.test(compact)) {
        push({ from: 'user', text })
        return reply({ text: t('chat.badOrder') })
      }
    }
    ask(text)
  }

  /** Hands the conversation to a person: the request form, with the category,
   *  the order and the concierge's summary — or, without one, the customer's
   *  own question — already filled in. They review it and send it there. */
  function toHuman(handoff?: Handoff) {
    const lastQuestion = [...history.current].reverse().find((m) => m.from === 'user' && m.text.split(/\s+/).length >= 3)
    const mentioned = history.current
      .filter((m) => m.from === 'user')
      .map((m) => /\bLV-?[A-Z0-9]{6}\b/i.exec(m.asked ?? m.text)?.[0])
      .filter((x): x is string => Boolean(x))
      .pop()
    openSupport({
      view: 'new',
      category: handoff?.category ?? (topic ? TOPIC_CATEGORY[topic] : undefined),
      orderNumber: handoff?.orderNumber ?? aboutOrder ?? (mentioned ? orderNumber(mentioned) ?? undefined : undefined),
      message: handoff?.summary ?? lastQuestion?.asked ?? lastQuestion?.text,
    })
  }

  function rate(message: Message, helpful: boolean) {
    if (!message.turnId || message.rated) return
    history.current = history.current.map((m) => (m.id === message.id ? { ...m, rated: true } : m))
    setMessages(history.current)
    void fetch('/api/support/assistant/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turnId: message.turnId,
        rating: helpful ? 'helpful' : 'not_helpful',
        outcome: message.handoff ? 'handoff' : message.products?.length ? 'products' : 'answered',
      }),
    }).catch(() => {})
  }

  function newConversation() {
    stopAll()
    try {
      window.sessionStorage.removeItem(STORE_KEY)
    } catch {
      // nothing stored
    }
    greet()
    inputRef.current?.focus()
  }

  const questions = topic ? FAQ.filter((e) => e.topic === topic) : []
  const busy = typing || inflight.current !== null
  const chip =
    'rounded-xl border border-border px-3 py-1.5 text-left text-[11px] text-foreground/80 transition-colors duration-200 hover:border-gold/60 hover:text-gold disabled:opacity-50'
  const goldButton =
    'flex items-center gap-1.5 rounded-xl border border-transparent bg-gold-gradient px-3 py-1.5 text-[11px] font-medium text-gold-foreground shadow-gold transition hover:brightness-[1.05]'
  const stockLabel = (s: ProductCard['stock']) => (s === 'in_stock' ? t('chat.inStock') : s === 'sold_out' ? t('sold.out') : t('chat.toOrder'))

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('chat.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
      // Not .hide-with-keyboard: that hides bottom-fixed bars while a field
      // has focus on a phone, and this panel HOLDS the field — it hid itself
      // the moment the customer tapped into it, so nothing could be typed.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className="animate-slide-in-right fixed bottom-0 right-0 z-[95] flex h-[min(80vh,640px)] w-full flex-col border-l border-t border-gold/25 bg-popover shadow-2xl sm:bottom-5 sm:right-5 sm:h-[580px] sm:w-[390px] sm:border"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {topic && (
            <button
              type="button"
              onClick={() => {
                setTopic(null)
                setSlot(null)
              }}
              aria-label={c.back}
              className="-ml-1 flex size-8 items-center justify-center text-muted-foreground transition hover:text-gold"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <Bot aria-hidden className="size-4 shrink-0 text-gold" />
          <div className="min-w-0">
            <p className="truncate text-[12px] uppercase tracking-[0.15em] text-foreground">{t('chat.title')}</p>
            <p className="truncate text-[10px] font-light text-muted-foreground">{t('chat.subtitle')}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          {messages.length > 1 && (
            <button
              type="button"
              onClick={newConversation}
              aria-label={t('chat.newChat')}
              title={t('chat.newChat')}
              className="flex size-8 items-center justify-center text-muted-foreground transition hover:text-gold"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label={c.close}
            className="flex size-8 items-center justify-center text-muted-foreground transition hover:text-gold"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-busy={busy}
        className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'max-w-[88%] whitespace-pre-line px-3.5 py-2.5 text-[13px] font-light leading-relaxed [overflow-wrap:anywhere]',
              m.from === 'bot'
                ? 'rounded-xl border border-border/60 bg-background/60 text-foreground/90'
                : 'ml-auto w-fit rounded-xl border border-gold/40 bg-gold/10 text-foreground',
            )}
          >
            {m.from === 'bot' ? <RichText text={m.text} /> : m.text}
            {m.products && m.products.length > 0 && (
              <ul aria-label={t('chat.suggested')} className="mt-2.5 space-y-1.5 whitespace-normal">
                {m.products.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={p.path}
                      className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/60 p-2 transition-colors hover:border-gold/60"
                    >
                      <span className="relative size-11 shrink-0 overflow-hidden rounded-lg border border-border/60">
                        <Image
                          src={productImage(p.image)}
                          alt=""
                          fill
                          sizes="44px"
                          className={cn('object-cover', p.stock === 'sold_out' && 'opacity-50 grayscale')}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[12px] text-foreground">{p.name}</span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {formatPrice(p.price)}
                          {p.oldPrice ? <s className="ml-1.5 opacity-70">{formatPrice(p.oldPrice)}</s> : null}
                          {' · '}
                          {stockLabel(p.stock)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {(m.handoff || m.retry) && (
              <div className="mt-2.5 flex flex-wrap gap-1.5 whitespace-normal">
                {m.retry && (
                  <button type="button" disabled={busy} onClick={() => retry(m)} className={cn(chip, 'border-gold/50 text-foreground')}>
                    {t('chat.retry')}
                  </button>
                )}
                <button type="button" onClick={() => toHuman(m.handoff)} className={goldButton}>
                  {t('chat.handoff')}
                  <ArrowRight aria-hidden className="size-3.5" />
                </button>
              </div>
            )}
            {m.turnId && (
              <div className="mt-2 flex items-center gap-1 whitespace-normal text-muted-foreground">
                {m.rated ? (
                  <span className="text-[10px] font-light">{t('chat.thanks')}</span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => rate(m, true)}
                      aria-label={t('chat.helpful')}
                      title={t('chat.helpful')}
                      className="flex size-7 items-center justify-center rounded-lg transition hover:text-gold"
                    >
                      <ThumbsUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => rate(m, false)}
                      aria-label={t('chat.notHelpful')}
                      title={t('chat.notHelpful')}
                      className="flex size-7 items-center justify-center rounded-lg transition hover:text-gold"
                    >
                      <ThumbsDown className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {typing && (
          <div role="status" aria-label={slow ? t('chat.slow') : t('chat.typing')} className="flex flex-col gap-1.5">
            <div className="chat-typing flex w-fit items-center gap-1 rounded-xl border border-border/60 bg-background/60 px-3.5 py-3">
              <span />
              <span />
              <span />
            </div>
            {slow && <p className="text-[11px] font-light text-muted-foreground">{t('chat.slow')}</p>}
          </div>
        )}
        {ai && messages.length === 1 && (
          <p className="text-center text-[10px] font-light text-muted-foreground">{t('chat.aiNote')}</p>
        )}
      </div>

      {/* Quick replies: the topics; inside a topic its questions, or while an
          order number is wanted, the customer's own orders. */}
      <div className="max-h-[36%] shrink-0 overflow-y-auto border-t border-border/50 px-4 py-3">
        {slot && myOrders.length > 0 && (
          <p className="mb-2 text-[11px] font-light text-muted-foreground">{t('chat.yourOrders')}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {slot &&
            myOrders.map((number) => (
              <button
                key={number}
                type="button"
                disabled={busy}
                onClick={() => fillSlot(slot, number)}
                className={cn(chip, 'border-gold/50 font-medium tabular-nums text-foreground')}
              >
                {number}
              </button>
            ))}
          {ai && !topic && suggestions.length === 0 && onProduct && (
            <button type="button" disabled={busy} onClick={() => ask(t('chat.aboutThisQ'), t('chat.aboutThis'))} className={cn(chip, 'border-gold/50 text-foreground')}>
              {t('chat.aboutThis')}
            </button>
          )}
          {ai && !topic && suggestions.length === 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                push({ from: 'user', text: t('chat.findPiece') })
                reply({ text: t('chat.findPieceIntro') }, () => inputRef.current?.focus())
              }}
              className={chip}
            >
              {t('chat.findPiece')}
            </button>
          )}
          {(suggestions.length > 0 ? suggestions : topic ? questions : SUPPORT_TOPICS).map((item) =>
            typeof item === 'string' ? (
              <button key={item} type="button" disabled={busy} onClick={() => pickTopic(item)} className={chip}>
                {c.topics[item]}
              </button>
            ) : (
              <button key={item.id} type="button" disabled={busy} onClick={() => pickQuestion(item)} className={chip}>
                {item.q[locale]}
              </button>
            ),
          )}
          <button type="button" onClick={() => toHuman()} className={goldButton}>
            {t('chat.toHuman')}
          </button>
        </div>
      </div>

      <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-border/50 px-3 py-3">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={slot ? t('chat.orderPlaceholder') : t('chat.placeholder')}
          aria-label={slot ? t('chat.orderPlaceholder') : t('chat.placeholder')}
          maxLength={1000}
          autoCapitalize={slot ? 'characters' : undefined}
          enterKeyHint="send"
          className="h-10 w-full rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-gold"
        />
        <button
          type="submit"
          disabled={!query.trim() || busy}
          aria-label={t('chat.send')}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gold/50 text-gold transition-colors duration-200 enabled:hover:bg-gold enabled:hover:text-gold-foreground disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </form>
      <PrivacyNotice purpose="privacy.chat" className="shrink-0 px-4 pb-3 text-[10px]" />
    </div>
  )
}
