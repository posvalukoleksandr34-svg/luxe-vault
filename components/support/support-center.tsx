'use client'

import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  FileText,
  Loader2,
  Mail,
  Paperclip,
  Search,
  Send,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SUPPORT_EMAIL, TELEGRAM_ADMIN } from '@/lib/data'
import { FULFILMENT, courierTrackingUrl, describeBusinessDays } from '@/lib/fulfilment'
import { ORDER_STATUS_KEYS } from '@/lib/i18n'
import { loadMyOrders, readOrderRegistry } from '@/lib/order-registry'
import { formatChf, formatPrice, useStore, type SupportEntry } from '@/lib/store'
import {
  ACCEPTED_TYPES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  fetchMyTickets,
  fetchTicket,
  formatBytes,
  prepareAttachment,
  submitReply,
  submitTicket,
} from '@/lib/support/client'
import { SUPPORT_COPY, SUPPORT_TOPICS, TOPIC_CATEGORY, fill, type SupportCopy, type SupportTopic } from '@/lib/support/copy'
import { FAQ, searchFaq, type FaqEntry } from '@/lib/support/faq'
import {
  SUPPORT_CATEGORIES,
  type Locale,
  type Order,
  type SupportAttachment,
  type SupportCategory,
  type SupportTicket,
  type SupportTicketDetail,
  type SupportTicketStatus,
} from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The support center: help search and topics, "Contact Support", the
 * customer's requests and orders, the request form and each conversation.
 *
 * One component in two frames — the wide drawer any page can open, and the
 * /support page — so there is one implementation, not two that drift.
 *
 * Deliberately NOT a chat. Nobody is sitting on the other end in real time,
 * so the frame says what it is — "Support Messages" — and when to expect an
 * answer (FULFILMENT.supportReply), and the customer is emailed when it comes.
 */

type View =
  | { view: 'home' }
  | { view: 'topic'; topic: SupportTopic }
  | { view: 'new'; category?: SupportCategory; orderNumber?: string }
  | { view: 'created'; ticket: SupportTicket; email: string }
  | { view: 'tickets' }
  | { view: 'ticket'; number: string; token?: string }

function fromEntry(entry?: SupportEntry): View {
  if (!entry) return { view: 'home' }
  if (entry.view === 'ticket' && entry.number) return { view: 'ticket', number: entry.number, token: entry.token }
  if (entry.view === 'new') return { view: 'new', category: entry.category, orderNumber: entry.orderNumber }
  if (entry.view === 'tickets') return { view: 'tickets' }
  return { view: 'home' }
}

const dateFmt = (locale: Locale, ms: number, withTime = false) =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }),
  }).format(ms)

export function SupportCenter({
  initial,
  layout,
  onClose,
  onTicketOpened,
}: {
  initial?: SupportEntry
  layout: 'drawer' | 'page'
  onClose?: () => void
  /** The page frame drops the access token from its URL once it has been
   *  used — it is kept on this device, and a URL gets shared. */
  onTicketOpened?: (number: string) => void
}) {
  const { locale, currentUser, shipping, openAccount, setSupportUnread } = useStore()
  const c = SUPPORT_COPY[locale]
  const replySpan = describeBusinessDays(FULFILMENT.supportReply, locale)

  const [view, setView] = useState<View>(() => fromEntry(initial))
  const [history, setHistory] = useState<View[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  function scrollTop() {
    if (layout === 'drawer') scrollRef.current?.scrollTo({ top: 0 })
    else window.scrollTo({ top: 0 })
  }
  function go(next: View) {
    setHistory((h) => [...h, view])
    setView(next)
    scrollTop()
  }
  function back() {
    const prev = history[history.length - 1]
    setHistory(history.slice(0, -1))
    setView(prev ?? { view: 'home' })
    scrollTop()
  }

  // ------------------------------------------------------------ data ----
  const [mine, setMine] = useState<{ state: 'loading' | 'ok' | 'error'; tickets: SupportTicket[] }>({
    state: 'loading',
    tickets: [],
  })
  const refreshMine = useCallback(async () => {
    const r = await fetchMyTickets()
    if (r.ok) {
      setMine({ state: 'ok', tickets: r.tickets })
      setSupportUnread(r.unread)
    } else {
      setMine((m) => ({ ...m, state: 'error' }))
    }
  }, [setSupportUnread])

  const userId = currentUser?.id

  const [orders, setOrders] = useState<Order[] | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!userId && readOrderRegistry().length === 0) {
      setOrders([])
      return
    }
    void loadMyOrders().then((r) => {
      if (!cancelled) setOrders(r.ok ? r.orders : [])
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  // The list loads with the screens that show it — and again on coming back
  // from a conversation, whose unread mark and status may have changed, or
  // after signing in.
  useEffect(() => {
    if (view.view === 'home' || view.view === 'tickets') void refreshMine()
  }, [view.view, refreshMine, userId])

  const faqVars = {
    span: describeBusinessDays(shipping.deliveryTimeframe, locale),
    price: formatPrice(shipping.shippingPrice, true),
    amount: formatPrice(shipping.freeShippingThreshold),
    returnDays: FULFILMENT.returnWindowDays,
    refund: describeBusinessDays(FULFILMENT.refund, locale),
    reply: replySpan,
  }
  const answer = (e: FaqEntry) => fill(e.a[locale], faqVars)

  return (
    <div className={cn('flex flex-col', layout === 'drawer' && 'h-full min-h-0')}>
      {layout === 'drawer' && (
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-4 sm:px-8 sm:py-5">
          <div className="flex min-w-0 items-center gap-2">
            {view.view !== 'home' && (
              <button
                type="button"
                onClick={back}
                aria-label={c.back}
                className="-ml-2 flex size-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-gold"
              >
                <ArrowLeft className="size-[18px]" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="truncate font-serif text-xl font-bold tracking-tight text-foreground">{c.title}</h2>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {fill(c.replyWithin, { span: replySpan })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={c.close}
            className="flex size-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-[18px]" />
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className={cn(layout === 'drawer' && 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-7 sm:px-8')}
      >
        {layout === 'page' && view.view !== 'home' && (
          <button
            type="button"
            onClick={back}
            className="mb-6 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition hover:text-gold"
          >
            <ArrowLeft className="size-3.5" />
            {c.back}
          </button>
        )}

        {view.view === 'home' && (
          <HomeView
            c={c}
            layout={layout}
            locale={locale}
            replySpan={replySpan}
            answer={answer}
            tickets={mine.tickets}
            orders={orders}
            signedIn={Boolean(currentUser)}
            onTopic={(topic) => go({ view: 'topic', topic })}
            onContact={(category) => go({ view: 'new', category })}
            onTicket={(t) => go({ view: 'ticket', number: t.number })}
            onAllTickets={() => go({ view: 'tickets' })}
            onSignIn={() => openAccount('orders')}
            onNavigate={onClose}
          />
        )}

        {view.view === 'topic' && (
          <div>
            <Eyebrow>{c.topicsTitle}</Eyebrow>
            <h3 className="mt-2 font-serif text-2xl font-bold tracking-tight text-foreground">{c.topics[view.topic]}</h3>
            <div className="mt-6">
              <FaqList entries={FAQ.filter((e) => e.topic === view.topic)} locale={locale} answer={answer} />
            </div>
            <StillNeedHelp c={c} onContact={() => go({ view: 'new', category: TOPIC_CATEGORY[view.topic] })} />
          </div>
        )}

        {view.view === 'new' && (
          <NewTicketForm
            c={c}
            locale={locale}
            signedIn={Boolean(currentUser)}
            orders={orders ?? []}
            initialCategory={view.category}
            initialOrder={view.orderNumber}
            replySpan={replySpan}
            onCreated={(ticket, email) => {
              void refreshMine()
              setHistory([])
              setView({ view: 'created', ticket, email: currentUser?.email ?? email })
              scrollTop()
            }}
          />
        )}

        {view.view === 'created' && (
          <div className="py-4">
            <Eyebrow>{c.createdTitle}</Eyebrow>
            <p className="mt-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{c.createdNumber}</p>
            <p className="mt-2 font-serif text-4xl font-bold tracking-[0.04em] text-gold tabular-nums">{view.ticket.number}</p>
            <div className="mt-6 h-px w-16 bg-gold/50" />
            <p className="mt-6 max-w-prose text-[13px] font-light leading-relaxed text-muted-foreground">
              {fill(c.createdBody, { email: view.email, span: replySpan })}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => go({ view: 'ticket', number: view.ticket.number })}
                className="border border-gold/40 bg-gold/5 px-6 py-3.5 text-[12px] uppercase tracking-[0.16em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
              >
                {c.openConversation}
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistory([])
                  setView({ view: 'home' })
                }}
                className="border border-border px-6 py-3.5 text-[12px] uppercase tracking-[0.16em] text-muted-foreground transition hover:text-foreground"
              >
                {c.back}
              </button>
            </div>
          </div>
        )}

        {view.view === 'tickets' && (
          <div>
            <h3 className="font-serif text-2xl font-bold tracking-tight text-foreground">{c.myTickets}</h3>
            <div className="mt-6">
              {mine.state === 'loading' && mine.tickets.length === 0 ? (
                <Loading c={c} />
              ) : mine.tickets.length === 0 ? (
                <p className="text-[13px] font-light text-muted-foreground">{c.noTickets}</p>
              ) : (
                mine.tickets.map((t) => (
                  <TicketRow key={t.id} t={t} c={c} locale={locale} onOpen={() => go({ view: 'ticket', number: t.number })} />
                ))
              )}
            </div>
          </div>
        )}

        {view.view === 'ticket' && (
          <TicketView
            key={view.number}
            number={view.number}
            token={view.token}
            c={c}
            locale={locale}
            replySpan={replySpan}
            onNew={() => go({ view: 'new' })}
            onLoaded={onTicketOpened}
          />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ home --

function HomeView({
  c,
  layout,
  locale,
  replySpan,
  answer,
  tickets,
  orders,
  signedIn,
  onTopic,
  onContact,
  onTicket,
  onAllTickets,
  onSignIn,
  onNavigate,
}: {
  c: SupportCopy
  layout: 'drawer' | 'page'
  locale: Locale
  replySpan: string
  answer: (e: FaqEntry) => string
  tickets: SupportTicket[]
  orders: Order[] | null
  signedIn: boolean
  onTopic: (t: SupportTopic) => void
  onContact: (category?: SupportCategory) => void
  onTicket: (t: SupportTicket) => void
  onAllTickets: () => void
  onSignIn: () => void
  onNavigate?: () => void
}) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchFaq(FAQ, locale, query, answer), [locale, query, answer])
  const cell = layout === 'drawer' ? 'bg-popover' : 'bg-background'
  const [first, ...rest] = SUPPORT_TOPICS

  return (
    <div>
      <section>
        {layout === 'page' && <Eyebrow>{c.title}</Eyebrow>}
        <h1
          className={cn(
            'font-serif font-bold tracking-tight text-foreground [text-wrap:balance]',
            layout === 'page' ? 'mt-3 text-4xl sm:text-5xl' : 'text-3xl',
          )}
        >
          {c.heading}
        </h1>
        <p className="mt-3 max-w-[60ch] text-[13px] font-light leading-relaxed text-muted-foreground">
          {fill(c.honest, { span: replySpan })}
        </p>
        <label className="relative mt-7 block">
          <span className="sr-only">{c.searchPlaceholder}</span>
          <Search className="pointer-events-none absolute left-0 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            id="support-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={c.searchPlaceholder}
            className="w-full border-b border-border bg-transparent py-3 pl-7 pr-2 text-[14px] font-light text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-gold/60"
          />
        </label>
      </section>

      {query.trim() ? (
        <section className="mt-6">
          {results.length > 0 ? (
            <FaqList entries={results} locale={locale} answer={answer} defaultOpen={results.length === 1} />
          ) : (
            <div className="border border-border/60 px-5 py-5">
              <p className="text-[13px] text-foreground">{fill(c.searchEmpty, { q: query.trim() })}</p>
              <p className="mt-1 text-[12px] font-light text-muted-foreground">{c.searchEmptyHint}</p>
            </div>
          )}
          <StillNeedHelp c={c} onContact={() => onContact()} />
        </section>
      ) : (
        <>
          <Section title={c.topicsTitle}>
            {/* Hairline grid: the gaps are the rules. The first topic spans
                the row, so six remain for three even rows of two. */}
            <div className="grid grid-cols-1 gap-px border border-border/60 bg-border/60 sm:grid-cols-2">
              {[first, ...rest].map((topic, i) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => onTopic(topic)}
                  className={cn(
                    'group flex items-center justify-between gap-3 px-4 py-3.5 text-left text-[13px] font-light text-foreground/85 transition hover:text-gold',
                    cell,
                    i === 0 && 'sm:col-span-2',
                  )}
                >
                  {c.topics[topic]}
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-gold" />
                </button>
              ))}
            </div>
          </Section>

          <button
            type="button"
            onClick={() => onContact()}
            className="group mt-8 flex w-full items-center justify-between gap-4 border border-gold/40 bg-gold/5 px-5 py-4 text-left transition-all duration-300 hover:bg-gold"
          >
            <span>
              <span className="block text-[12px] uppercase tracking-[0.18em] text-gold group-hover:text-gold-foreground">
                {c.contact}
              </span>
              <span className="mt-1 block text-[12px] font-light text-muted-foreground group-hover:text-gold-foreground/80">
                {c.contactHint}
              </span>
            </span>
            <Mail className="size-[18px] shrink-0 text-gold group-hover:text-gold-foreground" />
          </button>

          {tickets.length > 0 && (
            <Section
              title={c.myTickets}
              action={
                tickets.length > 3 ? (
                  <button
                    type="button"
                    onClick={onAllTickets}
                    className="text-[10px] uppercase tracking-[0.18em] text-gold/80 transition hover:text-gold"
                  >
                    {c.viewAll} · {tickets.length}
                  </button>
                ) : null
              }
            >
              {tickets.slice(0, 3).map((t) => (
                <TicketRow key={t.id} t={t} c={c} locale={locale} onOpen={() => onTicket(t)} />
              ))}
            </Section>
          )}

          <Section title={c.myOrders}>
            {orders === null ? (
              <Loading c={c} />
            ) : orders.length > 0 ? (
              orders.slice(0, 4).map((o) => <OrderRow key={o.id} o={o} c={c} locale={locale} onNavigate={onNavigate} />)
            ) : !signedIn ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] font-light text-muted-foreground">{c.ordersHint}</p>
                <button
                  type="button"
                  onClick={onSignIn}
                  className="text-[11px] uppercase tracking-[0.18em] text-gold transition hover:text-gold/80"
                >
                  {c.signIn}
                </button>
              </div>
            ) : (
              <p className="text-[12px] font-light text-muted-foreground">—</p>
            )}
          </Section>

          <p className="mt-10 text-[11px] font-light leading-relaxed text-muted-foreground/70">
            {c.orWrite.split('{email}')[0]}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-muted-foreground transition hover:text-gold">
              {SUPPORT_EMAIL}
            </a>
            {' · '}
            <a
              href={`https://t.me/${TELEGRAM_ADMIN.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition hover:text-gold"
            >
              {TELEGRAM_ADMIN}
            </a>
          </p>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------- pieces ----

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-[0.24em] text-gold/80">{children}</p>
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-border/50 pb-2.5">
        <h3 className="text-[10px] uppercase tracking-[0.22em] text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Loading({ c }: { c: SupportCopy }) {
  return (
    <p className="flex items-center gap-2 py-4 text-[12px] font-light text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {c.loading}
    </p>
  )
}

function StillNeedHelp({ c, onContact }: { c: SupportCopy; onContact: () => void }) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border/50 pt-6">
      <p className="font-serif text-lg text-foreground">{c.stillNeedHelp}</p>
      <button
        type="button"
        onClick={onContact}
        className="border border-gold/40 bg-gold/5 px-5 py-3 text-[11px] uppercase tracking-[0.16em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
      >
        {c.contact}
      </button>
    </div>
  )
}

function FaqList({
  entries,
  locale,
  answer,
  defaultOpen = false,
}: {
  entries: FaqEntry[]
  locale: Locale
  answer: (e: FaqEntry) => string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState<string | null>(defaultOpen ? entries[0]?.id ?? null : null)
  return (
    <div className="border-t border-border/50">
      {entries.map((e) => {
        const isOpen = open === e.id
        return (
          <div key={e.id} className="border-b border-border/50">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : e.id)}
              className={cn(
                'flex w-full items-start justify-between gap-4 py-4 text-left text-[13px] transition hover:text-gold',
                isOpen ? 'text-gold' : 'text-foreground/90',
              )}
            >
              <span>{e.q[locale]}</span>
              <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')} />
            </button>
            {isOpen && (
              <p className="-mt-1 max-w-[62ch] pb-5 pr-6 text-[13px] font-light leading-relaxed text-muted-foreground">
                {answer(e)}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

const STATUS_STYLE: Record<SupportTicketStatus, string> = {
  open: 'border-gold/40 text-gold',
  in_progress: 'border-foreground/25 text-foreground/80',
  waiting_user: 'border-gold bg-gold/10 text-gold',
  resolved: 'border-emerald-500/30 text-emerald-400/90',
  closed: 'border-border text-muted-foreground',
}

function StatusPill({ status, c }: { status: SupportTicketStatus; c: SupportCopy }) {
  return (
    <span className={cn('whitespace-nowrap border px-2 py-0.5 text-[9px] uppercase tracking-[0.16em]', STATUS_STYLE[status])}>
      {c.statuses[status]}
    </span>
  )
}

function TicketRow({ t, c, locale, onOpen }: { t: SupportTicket; c: SupportCopy; locale: Locale; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-start justify-between gap-4 border-b border-border/50 py-3.5 text-left"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="font-mono tracking-[0.06em]">{t.number}</span>
          {t.unread && (
            <span className="flex items-center gap-1.5 text-gold">
              <span className="size-1.5 rounded-full bg-gold" aria-hidden />
              {c.newReply}
            </span>
          )}
        </span>
        <span className="mt-1 block truncate text-[13px] text-foreground/90 transition group-hover:text-gold">{t.subject}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <StatusPill status={t.status} c={c} />
        <span className="text-[10px] tabular-nums text-muted-foreground/70">{dateFmt(locale, t.lastMessageAt)}</span>
      </span>
    </button>
  )
}

function OrderRow({ o, c, locale, onNavigate }: { o: Order; c: SupportCopy; locale: Locale; onNavigate?: () => void }) {
  const { t } = useStore()
  const tracking = courierTrackingUrl(o.courierName, o.trackingNumber)
  const statusKey = ORDER_STATUS_KEYS[o.status as keyof typeof ORDER_STATUS_KEYS]
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 py-3.5">
      <div className="min-w-0">
        <p className="font-mono text-[12px] tracking-[0.06em] text-foreground">{o.id}</p>
        <p className="mt-0.5 text-[11px] font-light text-muted-foreground">
          {dateFmt(locale, o.createdAt)} · {statusKey ? t(statusKey) : o.status} · {formatChf(o.total)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 text-[10px] uppercase tracking-[0.16em]">
        <Link
          href={`/order/${encodeURIComponent(o.id)}`}
          onClick={onNavigate}
          className="text-muted-foreground transition hover:text-gold"
        >
          {c.orderDetails}
        </Link>
        {tracking ? (
          <a
            href={tracking.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-gold transition hover:text-gold/80"
          >
            {c.track}
            <ArrowUpRight className="size-3" />
          </a>
        ) : o.trackingNumber ? (
          <span className="font-mono normal-case tracking-normal text-muted-foreground">{o.trackingNumber}</span>
        ) : null}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- attachments --

function AttachmentPicker({
  id,
  c,
  files,
  onChange,
  onError,
}: {
  id: string
  c: SupportCopy
  files: File[]
  onChange: (files: File[]) => void
  onError: (message: string | null) => void
}) {
  const [preparing, setPreparing] = useState(false)
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith('image/') && !/hei[cf]/.test(f.type) ? URL.createObjectURL(f) : null)),
    [files],
  )
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews])

  async function add(list: FileList | null) {
    if (!list || list.length === 0) return
    // Some browsers report HEIC photos with no type at all.
    const incoming = Array.from(list).map((f) =>
      f.type ? f : /\.hei[cf]$/i.test(f.name) ? new File([f], f.name, { type: 'image/heic' }) : f,
    )
    if (incoming.some((f) => ACCEPTED_TYPES.indexOf(f.type) === -1)) return onError(c.attachType)
    if (files.length + incoming.length > MAX_FILES) return onError(c.attachTooMany)
    setPreparing(true)
    const prepared = await Promise.all(incoming.map(prepareAttachment))
    setPreparing(false)
    const all = [...files, ...prepared]
    if (all.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) return onError(c.attachTooBig)
    onError(null)
    onChange(all)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label
          htmlFor={id}
          className="flex cursor-pointer items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-gold/90 transition hover:text-gold"
        >
          {preparing ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
          {c.attach}
        </label>
        <span className="text-[11px] font-light text-muted-foreground/60">{c.attachHint}</span>
        <input
          id={id}
          type="file"
          multiple
          accept={`${ACCEPTED_TYPES.join(',')},.heic,.heif`}
          className="sr-only"
          onChange={(e) => {
            void add(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 border border-border py-1.5 pl-1.5 pr-2">
              {previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[i] as string} alt="" className="size-8 object-cover" />
              ) : (
                <span className="flex size-8 items-center justify-center bg-accent/40">
                  <FileText className="size-3.5 text-muted-foreground" />
                </span>
              )}
              <span className="max-w-[9rem] truncate text-[11px] text-foreground/85">{f.name}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`${c.remove} ${f.name}`}
                className="text-muted-foreground/60 transition hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MessageAttachments({ items }: { items: SupportAttachment[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((a) =>
        a.url && a.type.startsWith('image/') && !/hei[cf]/.test(a.type) ? (
          <a key={a.path} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name} className="size-20 border border-border object-cover transition hover:border-gold/50" />
          </a>
        ) : (
          <a
            key={a.path}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 border border-border px-3 py-2 text-[11px] text-foreground/85 transition hover:border-gold/50 hover:text-gold"
          >
            <FileText className="size-3.5" />
            <span className="max-w-[12rem] truncate">{a.name}</span>
            <span className="text-muted-foreground/60">{formatBytes(a.size)}</span>
          </a>
        ),
      )}
    </div>
  )
}

// ------------------------------------------------------------------ form --

const FIELD =
  'w-full border border-border bg-transparent px-3.5 py-3 text-[13px] font-light text-foreground outline-none transition placeholder:text-muted-foreground/45 focus:border-gold/50'
const LABEL = 'mb-2 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground'

function NewTicketForm({
  c,
  locale,
  signedIn,
  orders,
  initialCategory,
  initialOrder,
  replySpan,
  onCreated,
}: {
  c: SupportCopy
  locale: Locale
  signedIn: boolean
  orders: Order[]
  initialCategory?: SupportCategory
  initialOrder?: string
  replySpan: string
  onCreated: (ticket: SupportTicket, email: string) => void
}) {
  const [category, setCategory] = useState<SupportCategory>(initialCategory ?? (initialOrder ? 'order' : 'other'))
  const [orderNumber, setOrderNumber] = useState(initialOrder ?? '')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    if (!subject.trim() || !message.trim()) return setError(c.required)
    setSending(true)
    setError(null)
    const form = new FormData()
    form.set('category', category)
    form.set('subject', subject.trim())
    form.set('message', message.trim())
    form.set('locale', locale)
    if (orderNumber) form.set('orderNumber', orderNumber)
    if (!signedIn) {
      form.set('email', email.trim())
      if (name.trim()) form.set('name', name.trim())
    }
    files.forEach((f) => form.append('files', f, f.name))
    const r = await submitTicket(form)
    setSending(false)
    if (r.ok) onCreated(r.ticket, email.trim())
    else setError(r.status > 0 && r.status < 500 && r.error ? r.error : c.error)
  }

  return (
    <form onSubmit={submit} noValidate>
      <h3 className="font-serif text-2xl font-bold tracking-tight text-foreground">{c.newTitle}</h3>
      <p className="mt-2 text-[12px] font-light text-muted-foreground">{fill(c.replyWithin, { span: replySpan })}</p>

      <fieldset className="mt-8">
        <legend className={LABEL}>{c.category}</legend>
        <div className="flex flex-wrap gap-2">
          {SUPPORT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
              className={cn(
                'border px-3.5 py-2 text-[12px] font-light transition',
                category === cat
                  ? 'border-gold bg-gold/5 text-gold'
                  : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
              )}
            >
              {c.categories[cat]}
            </button>
          ))}
        </div>
      </fieldset>

      {orders.length > 0 && (
        <div className="mt-6">
          <label htmlFor="support-order" className={LABEL}>
            {c.order}
          </label>
          <select
            id="support-order"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            className={cn(FIELD, 'appearance-none bg-popover')}
          >
            <option value="">{c.orderNone}</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} · {dateFmt(locale, o.createdAt)} · {formatChf(o.total)}
              </option>
            ))}
          </select>
        </div>
      )}

      {!signedIn && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="support-email" className={LABEL}>
              {c.email}
            </label>
            <input
              id="support-email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="support-name" className={LABEL}>
              {c.name} <span className="normal-case tracking-normal text-muted-foreground/50">· {c.optional}</span>
            </label>
            <input
              id="support-name"
              type="text"
              autoComplete="name"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
            />
          </div>
        </div>
      )}

      <div className="mt-6">
        <label htmlFor="support-subject" className={LABEL}>
          {c.subject}
        </label>
        <input
          id="support-subject"
          type="text"
          maxLength={150}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={c.subjectPh}
          className={FIELD}
        />
      </div>

      <div className="mt-6">
        <label htmlFor="support-message" className={LABEL}>
          {c.message}
        </label>
        <textarea
          id="support-message"
          rows={6}
          maxLength={5000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={c.messagePh}
          className={cn(FIELD, 'resize-y leading-relaxed')}
        />
      </div>

      <div className="mt-4">
        <AttachmentPicker id="support-files" c={c} files={files} onChange={setFiles} onError={setError} />
      </div>

      {error && (
        <p role="alert" className="mt-5 text-[12px] font-light text-destructive/90">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={sending || !subject.trim() || !message.trim() || (!signedIn && !email.trim())}
        className="mt-7 flex w-full items-center justify-center gap-2 border border-gold/40 bg-gold/5 py-4 text-[12px] uppercase tracking-[0.18em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
      >
        {sending && <Loader2 className="size-3.5 animate-spin" />}
        {sending ? c.sending : c.submit}
      </button>
    </form>
  )
}

// --------------------------------------------------------------- ticket ----

function TicketView({
  number,
  token,
  c,
  locale,
  replySpan,
  onNew,
  onLoaded,
}: {
  number: string
  token?: string
  c: SupportCopy
  locale: Locale
  replySpan: string
  onNew: () => void
  onLoaded?: (number: string) => void
}) {
  const [state, setState] = useState<
    { s: 'loading' } | { s: 'error'; notFound: boolean } | { s: 'ok'; ticket: SupportTicketDetail; token: string }
  >({ s: 'loading' })
  const [reply, setReply] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setState({ s: 'loading' })
    const r = await fetchTicket(number, token)
    if (r.ok) {
      setState({ s: 'ok', ticket: r.ticket, token: r.token })
      onLoaded?.(r.ticket.number)
    } else {
      setState({ s: 'error', notFound: r.status === 404 })
    }
  }, [number, token, onLoaded])

  useEffect(() => {
    void load()
  }, [load])

  if (state.s === 'loading') return <Loading c={c} />
  if (state.s === 'error') {
    return (
      <div className="border border-border/60 px-5 py-6">
        <p className="text-[13px] font-light leading-relaxed text-muted-foreground">{state.notFound ? c.notFound : c.loadError}</p>
        <div className="mt-4 flex flex-wrap gap-4">
          {!state.notFound && (
            <button type="button" onClick={() => void load()} className="text-[11px] uppercase tracking-[0.18em] text-gold">
              {c.retry}
            </button>
          )}
          <button type="button" onClick={onNew} className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-gold">
            {c.newRequest}
          </button>
        </div>
      </div>
    )
  }

  const { ticket } = state
  const closed = ticket.status === 'closed'

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (state.s !== 'ok' || sending || !reply.trim()) return
    setSending(true)
    setError(null)
    const form = new FormData()
    form.set('message', reply.trim())
    form.set('t', state.token)
    files.forEach((f) => form.append('files', f, f.name))
    const r = await submitReply(ticket.number, form)
    setSending(false)
    if (r.ok) {
      setState({
        s: 'ok',
        token: state.token,
        ticket: { ...ticket, status: r.status, lastMessageAt: r.message.createdAt, messages: [...ticket.messages, r.message] },
      })
      setReply('')
      setFiles([])
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    } else if (r.status === 409) {
      setState({ s: 'ok', token: state.token, ticket: { ...ticket, status: 'closed' } })
    } else {
      setError(r.status > 0 && r.status < 500 && r.error ? r.error : c.error)
    }
  }

  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground">{ticket.number}</p>
      <h3 className="mt-1.5 font-serif text-2xl font-bold tracking-tight text-foreground [text-wrap:balance]">{ticket.subject}</h3>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-light text-muted-foreground">
        <StatusPill status={ticket.status} c={c} />
        <span>{c.categories[ticket.category]}</span>
        {ticket.orderNumber && <span>· {fill(c.orderRef, { id: ticket.orderNumber })}</span>}
        <span>· {fill(c.opened, { date: dateFmt(locale, ticket.createdAt) })}</span>
      </div>
      <p className="mt-3 text-[12px] font-light text-muted-foreground/80">
        {fill(c.statusHints[ticket.status], { span: replySpan })}
      </p>

      <ol className="mt-8 space-y-6 border-t border-border/50 pt-6">
        {ticket.messages.map((m) => {
          const staff = m.author === 'staff'
          return (
            <li key={m.id} className={cn('border-l pl-4', staff ? 'border-gold/70' : 'border-border')}>
              <p className="flex flex-wrap items-baseline gap-x-2 text-[10px] uppercase tracking-[0.18em]">
                <span className={staff ? 'text-gold' : 'text-foreground/80'}>{staff ? c.team : c.you}</span>
                <span className="normal-case tracking-normal text-muted-foreground/60 tabular-nums">
                  {dateFmt(locale, m.createdAt, true)}
                </span>
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-[13px] font-light leading-relaxed text-foreground/90">
                {m.body}
              </p>
              <MessageAttachments items={m.attachments} />
            </li>
          )
        })}
      </ol>
      <div ref={endRef} />

      {closed ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-border/60 px-5 py-4">
          <p className="text-[12px] font-light text-muted-foreground">{c.closedNote}</p>
          <button type="button" onClick={onNew} className="text-[11px] uppercase tracking-[0.18em] text-gold transition hover:text-gold/80">
            {c.newRequest}
          </button>
        </div>
      ) : (
        <form onSubmit={send} className="mt-8 border-t border-border/50 pt-6">
          <label htmlFor="support-reply" className="sr-only">
            {c.replyPh}
          </label>
          <textarea
            id="support-reply"
            rows={4}
            maxLength={5000}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={c.replyPh}
            className={cn(FIELD, 'resize-y leading-relaxed')}
          />
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <AttachmentPicker id="support-reply-files" c={c} files={files} onChange={setFiles} onError={setError} />
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="flex items-center gap-2 border border-gold/40 bg-gold/5 px-6 py-3 text-[11px] uppercase tracking-[0.18em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {c.send}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-[12px] font-light text-destructive/90">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
