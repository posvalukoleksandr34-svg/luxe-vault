'use client'

import { ArrowLeft, ArrowRight, Bot, Send, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { readOrderRegistry } from '@/lib/order-registry'
import { FAQ, searchFaq, type FaqEntry } from '@/lib/support/faq'
import { SUPPORT_COPY, SUPPORT_TOPICS, TOPIC_CATEGORY, fill, type SupportTopic } from '@/lib/support/copy'
import { formatPrice, useStore } from '@/lib/store'
import type { Locale, SupportCategory } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PrivacyNotice } from '@/components/privacy-notice'

/**
 * The concierge behind the floating button, bottom left.
 *
 * TWO MODES, ONE WIDGET.
 *
 *   AI — free text goes to /api/support/assistant: a model that answers from
 *   the shop's own policies and the customer's own orders (see
 *   lib/server/assistant/), and hands over to a person when it cannot.
 *
 *   Help centre — when the concierge is off (no model configured, or it
 *   failed), every reply is an answer already written for the help centre
 *   (lib/support/faq.ts), with the live shipping figures filled in: the bot
 *   this widget used to be. The widget asks which mode it is in when it opens,
 *   and drops to the help centre for the rest of the conversation the first
 *   time the model is unavailable.
 *
 * BUTTONS COLLECT, THEN ASK. The order topics — "Where is my order?",
 * "Returns" — do not show text: they ask for the order number (offering the
 * customer's own orders as one-tap choices), check its shape here, and then
 * put the full question to the concierge. The other topics offer their
 * prepared questions, answered instantly and exactly.
 *
 * It opens on the LEFT, over the button that opens it — which hides itself
 * while the bot is up (components/support-widget.tsx), so the panel is never
 * sitting on top of its own trigger. It shares the single `panel` value with
 * every other drawer, so opening it closes the cart, the account or the
 * support centre rather than stacking.
 */

type Handoff = { category: SupportCategory; summary: string }

type Message = {
  id: string
  from: 'bot' | 'user'
  text: string
  /** What the model reads for this turn, when it differs from what is shown
   *  ("LV-7K2M9Q" shown, "Where is my order LV-7K2M9Q?" asked). */
  asked?: string
  handoff?: Handoff
}

/** An order-number question the widget is collecting. */
type Slot = 'where' | 'returns'

let seq = 0
const nextId = () => `m${++seq}`

/** Instant answers still get a moment of "typing": a reply that lands in the
 *  same frame as the question reads as canned. */
const TYPING_MS = 450

/** Same rule as the server (lib/server/assistant/orders.ts). Only read
 *  while an order number has just been asked for: numbers can be all letters
 *  (lib/server/order-drafts.ts), so outside that question a six-letter word
 *  would look like one. */
function orderNumber(raw: string): string | null {
  const match = /^(?:LV-?)?([A-Z0-9]{6})$/.exec(raw.toUpperCase().replace(/[#\s№]/g, ''))
  return match ? `LV-${match[1]}` : null
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
  const [slot, setSlot] = useState<Slot | null>(null)
  /** The customer's own order numbers, offered while a slot is open. */
  const [myOrders, setMyOrders] = useState<string[]>([])
  /** The order the conversation is about, for a hand-over. */
  const [aboutOrder, setAboutOrder] = useState<string | undefined>()
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** The conversation as the server should read it — kept in a ref so a
   *  reply never races a stale copy of the state. */
  const history = useRef<Message[]>([])

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

  // The opening line, once per opening, in the visitor's language — and the
  // question of which mode this conversation runs in.
  useEffect(() => {
    if (!open) return
    const greeting: Message = { from: 'bot', text: t('chat.greeting'), id: nextId() }
    history.current = [greeting]
    setMessages([greeting])
    setTopic(null)
    setSuggestions([])
    setQuery('')
    setSlot(null)
    setAboutOrder(undefined)
    let cancelled = false
    fetch('/api/support/assistant')
      .then((r) => (r.ok ? r.json() : { ai: false }))
      .then((d: { ai?: boolean }) => !cancelled && setAi(Boolean(d.ai)))
      .catch(() => !cancelled && setAi(false))
    return () => {
      cancelled = true
    }
  }, [open, t])

  // Every new message, and the typing dots, scroll into view.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing])

  if (!open) return null

  const push = (message: Omit<Message, 'id'>) => {
    const next = { ...message, id: nextId() }
    history.current = [...history.current, next]
    setMessages(history.current)
  }

  /** A prepared reply, after a short beat of typing. */
  const reply = (text: string, after?: () => void) => {
    setTyping(true)
    window.setTimeout(() => {
      setTyping(false)
      push({ from: 'bot', text })
      after?.()
    }, TYPING_MS)
  }

  /** Help-centre mode: the prepared answers only — a hit is answered, a near
   *  miss is offered as questions, a total miss offers a person. */
  function answerFromHelpCentre(text: string) {
    const hits = searchFaq(FAQ, locale, text, answerOf)
    if (hits.length > 0) return reply(answerOf(hits[0]), () => setSuggestions(hits.slice(1, 4)))
    const near = relatedQuestions(locale, text, answerOf)
    if (near.length > 0) return reply(t('chat.maybe'), () => setSuggestions(near))
    reply(t('chat.noAnswer'), () => setSuggestions([]))
  }

  /** Puts a question to the concierge. `shown` is what the customer sees as
   *  their message, when the question itself was built by the widget. */
  async function ask(question: string, shown?: string) {
    setSuggestions([])
    setSlot(null)
    push({ from: 'user', text: shown ?? question, asked: shown ? question : undefined })
    // Until the server has answered whether it is on, try the concierge.
    if (ai === false) return answerFromHelpCentre(question)

    setTyping(true)
    try {
      const res = await fetch('/api/support/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale,
          messages: history.current.map((m) => ({ role: m.from === 'bot' ? 'assistant' : 'user', text: m.asked ?? m.text })),
          orders: readOrderRegistry(),
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | { mode: 'ai'; reply: string; handoff?: Handoff }
        | { mode: 'fallback' }
        | null
      setTyping(false)
      if (res.ok && data?.mode === 'ai') {
        push({ from: 'bot', text: data.reply, handoff: data.handoff })
        return
      }
    } catch {
      setTyping(false)
    }
    // No model this time: the prepared answers, for the rest of the chat.
    setAi(false)
    answerFromHelpCentre(question)
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
      reply(t(next === 'where' ? 'chat.askOrder' : 'chat.askReturnOrder'), () => inputRef.current?.focus())
      return
    }
    setSlot(null)
    reply(t('chat.topicIntro'))
  }

  function pickQuestion(entry: FaqEntry) {
    push({ from: 'user', text: entry.q[locale] })
    setSuggestions([])
    reply(answerOf(entry))
  }

  /** An order number for the open slot: the full question goes to the
   *  concierge, the customer sees just the number they gave. */
  function fillSlot(which: Slot, number: string) {
    setAboutOrder(number)
    void ask(t(which === 'where' ? 'chat.whereIs' : 'chat.returnOrder').replace('{n}', number), number)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = query.trim()
    if (!text || typing) return
    setQuery('')
    if (slot) {
      const number = orderNumber(text)
      if (number) return fillSlot(slot, number)
      // A sentence rather than a number: the customer has moved on — let the
      // concierge read it. A short miss is a mistyped number: ask again.
      if (text.split(/\s+/).length < 3) {
        push({ from: 'user', text })
        return reply(t('chat.badOrder'))
      }
    }
    void ask(text)
  }

  /** Hands the conversation to a person: the request form, with the topic's
   *  category, the order and the concierge's summary already filled in. */
  function toHuman(handoff?: Handoff) {
    openSupport({
      view: 'new',
      category: handoff?.category ?? (topic ? TOPIC_CATEGORY[topic] : undefined),
      orderNumber: aboutOrder,
      message: handoff?.summary,
    })
  }

  const questions = topic ? FAQ.filter((e) => e.topic === topic) : []
  const chip =
    'rounded-xl border border-border px-3 py-1.5 text-left text-[11px] text-foreground/80 transition-colors duration-200 hover:border-gold/60 hover:text-gold'

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('chat.title')}
      // Not .hide-with-keyboard: that hides bottom-fixed bars while a field
      // has focus on a phone, and this panel HOLDS the field — it hid itself
      // the moment the customer tapped into it, so nothing could be typed.
      className="animate-slide-in-left fixed bottom-0 left-0 z-[95] flex h-[min(80vh,640px)] w-full flex-col border-r border-t border-gold/25 bg-popover shadow-2xl sm:bottom-5 sm:left-5 sm:h-[560px] sm:w-[380px] sm:border"
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
        <button
          type="button"
          onClick={() => setPanel(null)}
          aria-label={c.close}
          className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition hover:text-gold"
        >
          <X className="size-4" />
        </button>
      </header>

      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'max-w-[85%] whitespace-pre-line px-3.5 py-2.5 text-[13px] font-light leading-relaxed',
              m.from === 'bot'
                ? 'rounded-xl border border-border/60 bg-background/60 text-foreground/90'
                : 'ml-auto w-fit rounded-xl border border-gold/40 bg-gold/10 text-foreground',
            )}
          >
            {m.text}
            {m.handoff && (
              <button
                type="button"
                onClick={() => toHuman(m.handoff)}
                className="mt-2.5 flex items-center gap-1.5 rounded-xl border border-transparent bg-gold-gradient px-3 py-1.5 text-[11px] font-medium text-gold-foreground shadow-gold transition hover:brightness-[1.05]"
              >
                {t('chat.handoff')}
                <ArrowRight aria-hidden className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        {typing && (
          <div
            role="status"
            aria-label={t('chat.typing')}
            className="chat-typing flex w-fit items-center gap-1 rounded-xl border border-border/60 bg-background/60 px-3.5 py-3"
          >
            <span />
            <span />
            <span />
          </div>
        )}
        {ai && messages.length === 1 && (
          <p className="text-center text-[10px] font-light text-muted-foreground">{t('chat.aiNote')}</p>
        )}
      </div>

      {/* Quick replies: the topics; inside a topic its questions, or while an
          order number is wanted, the customer's own orders. */}
      <div className="max-h-[38%] shrink-0 overflow-y-auto border-t border-border/50 px-4 py-3">
        {slot && myOrders.length > 0 && (
          <p className="mb-2 text-[11px] font-light text-muted-foreground">{t('chat.yourOrders')}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {slot &&
            myOrders.map((number) => (
              <button
                key={number}
                type="button"
                disabled={typing}
                onClick={() => fillSlot(slot, number)}
                className={cn(chip, 'border-gold/50 font-medium tabular-nums text-foreground')}
              >
                {number}
              </button>
            ))}
          {(suggestions.length > 0 ? suggestions : topic ? questions : SUPPORT_TOPICS).map((item) =>
            typeof item === 'string' ? (
              <button key={item} type="button" disabled={typing} onClick={() => pickTopic(item)} className={chip}>
                {c.topics[item]}
              </button>
            ) : (
              <button key={item.id} type="button" disabled={typing} onClick={() => pickQuestion(item)} className={chip}>
                {item.q[locale]}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => toHuman()}
            className="rounded-xl border border-transparent bg-gold-gradient px-3 py-1.5 text-[11px] font-medium text-gold-foreground shadow-gold transition-colors duration-200 hover:brightness-[1.05]"
          >
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
          className="h-10 w-full rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-gold"
        />
        <button
          type="submit"
          disabled={!query.trim() || typing}
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
