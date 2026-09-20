'use client'

import { ArrowLeft, Bot, Send, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { FAQ, searchFaq, type FaqEntry } from '@/lib/support/faq'
import { SUPPORT_COPY, SUPPORT_TOPICS, TOPIC_CATEGORY, fill, type SupportTopic } from '@/lib/support/copy'
import { formatPrice, useStore } from '@/lib/store'
import type { Locale } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The quick-answers assistant behind the floating button, bottom left.
 *
 * It is a GUIDED bot, not a model: every reply it gives is an answer already
 * written for the help centre (lib/support/faq.ts), with the figures filled
 * from the live shipping settings — the same `answer()` the support drawer
 * uses. So it cannot quote a delivery time, a fee or a returns window the shop
 * does not actually offer, which is the one failure mode a shop's chat bot
 * must not have.
 *
 * What it does: greets, offers the seven topics, answers their questions, and
 * takes free text through the help centre's own search. What it never does is
 * pretend: anything it has no answer for goes straight to a human, by handing
 * over to the ticket form — the other support entry point, in the header.
 *
 * It sits on the RIGHT, mirroring the button that opens it on the left, and
 * shares the single `panel` value with every other drawer, so opening it
 * closes the cart, the account or the support centre rather than stacking.
 */

type Message =
  | { from: 'bot'; text: string; id: string }
  | { from: 'user'; text: string; id: string }

let seq = 0
const nextId = () => `m${++seq}`

/**
 * A second pass for free text, used only when the help centre's own search
 * finds nothing.
 *
 * searchFaq requires EVERY word to appear, which is right for a search box and
 * too strict for a sentence someone types at a bot: "возврат денег" misses
 * every returns answer because no entry contains "денег". This ranks entries
 * by how many of the words they do match, comparing on the first five
 * characters so Russian and German endings ("возврат" / "возврата") still
 * line up.
 *
 * What it returns are SUGGESTIONS, offered as questions to tap — never posted
 * as though the bot had understood. A near miss presented as an answer is
 * worse than admitting the miss.
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
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // The opening line, once per opening, in the visitor's language.
  useEffect(() => {
    if (!open) return
    setMessages([{ from: 'bot', text: t('chat.greeting'), id: nextId() }])
    setTopic(null)
    setSuggestions([])
    setQuery('')
  }, [open, t])

  // Every new message scrolls itself into view, the way a chat should.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  if (!open) return null

  const say = (from: Message['from'], text: string) =>
    setMessages((prev) => [...prev, { from, text, id: nextId() }])

  function pickTopic(next: SupportTopic) {
    say('user', c.topics[next])
    setTopic(next)
    setSuggestions([])
    say('bot', t('chat.topicIntro'))
  }

  function pickQuestion(entry: FaqEntry) {
    say('user', entry.q[locale])
    say('bot', answerOf(entry))
    setSuggestions([])
  }

  /** Free text goes through the help centre's own search first, then through
   *  the relaxed pass above. A hit is answered, a near miss is offered as
   *  questions, and a total miss says so and offers a human — the bot never
   *  invents something plausible. */
  function submitQuery(e: React.FormEvent) {
    e.preventDefault()
    const text = query.trim()
    if (!text) return
    say('user', text)
    setQuery('')
    const hits = searchFaq(FAQ, locale, text, answerOf)
    if (hits.length > 0) {
      say('bot', answerOf(hits[0]))
      setSuggestions(hits.slice(1, 4))
      return
    }
    // Nothing matched every word. Offer the nearest questions instead of
    // answering something that was not asked.
    const near = relatedQuestions(locale, text, answerOf)
    if (near.length > 0) {
      say('bot', t('chat.maybe'))
      setSuggestions(near)
      return
    }
    say('bot', t('chat.noAnswer'))
    setSuggestions([])
  }

  /** Hands the conversation to a person: the manual request form, carrying the
   *  topic's category so the customer does not choose it twice. */
  function toHuman() {
    openSupport({ view: 'new', category: topic ? TOPIC_CATEGORY[topic] : undefined })
  }

  const questions = topic ? FAQ.filter((e) => e.topic === topic) : []

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('chat.title')}
      className="hide-with-keyboard animate-slide-in-right fixed bottom-0 right-0 z-[95] flex h-[min(80vh,640px)] w-full flex-col border-l border-t border-gold/25 bg-popover shadow-2xl sm:bottom-5 sm:right-5 sm:h-[560px] sm:w-[380px] sm:border"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {topic && (
            <button
              type="button"
              onClick={() => setTopic(null)}
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

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        {messages.map((m) => (
          <p
            key={m.id}
            className={cn(
              'max-w-[85%] px-3.5 py-2.5 text-[13px] font-light leading-relaxed',
              m.from === 'bot'
                ? 'border border-border/60 bg-background/60 text-foreground/90'
                : 'ml-auto border border-gold/40 bg-gold/10 text-foreground',
            )}
          >
            {m.text}
          </p>
        ))}
      </div>

      {/* Quick replies: the topics, then that topic's questions. */}
      <div className="max-h-[38%] shrink-0 overflow-y-auto border-t border-border/50 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {(suggestions.length > 0 ? suggestions : topic ? questions : SUPPORT_TOPICS).map((item) =>
            typeof item === 'string' ? (
              <button
                key={item}
                type="button"
                onClick={() => pickTopic(item)}
                className="border border-border px-3 py-1.5 text-[11px] text-foreground/80 transition-colors duration-200 hover:border-gold/60 hover:text-gold"
              >
                {c.topics[item]}
              </button>
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={() => pickQuestion(item)}
                className="border border-border px-3 py-1.5 text-left text-[11px] text-foreground/80 transition-colors duration-200 hover:border-gold/60 hover:text-gold"
              >
                {item.q[locale]}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={toHuman}
            className="border border-gold/50 bg-gold/5 px-3 py-1.5 text-[11px] text-gold transition-colors duration-200 hover:bg-gold hover:text-gold-foreground"
          >
            {t('chat.toHuman')}
          </button>
        </div>
      </div>

      <form onSubmit={submitQuery} className="flex shrink-0 items-center gap-2 border-t border-border/50 px-3 py-3">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          className="h-10 w-full border border-border bg-background px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-gold"
        />
        <button
          type="submit"
          disabled={!query.trim()}
          aria-label={t('chat.send')}
          className="flex size-10 shrink-0 items-center justify-center border border-gold/50 text-gold transition-colors duration-200 enabled:hover:bg-gold enabled:hover:text-gold-foreground disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  )
}
