'use client'

import { AlertCircle, ArrowLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from '@/components/locale-link'
import type { UIKey } from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The customer's refund and return requests: the list, and one request with
 * its history, messages and what they can do next. Everything shown comes
 * from /api/refunds/cases — a projection that never includes risk scores,
 * internal notes or staff names (lib/server/refunds/customer-view.ts).
 */

type Summary = {
  caseNumber: string
  orderNumber: string
  claimType: string
  state: string
  requestedResolution: string
  approvedResolution?: string
  requestedAmountMinor?: number
  approvedAmountMinor?: number
  refundedAmountMinor: number
  createdAt: number
  updatedAt: number
}

type Detail = Summary & {
  description: string
  decisionNote?: string
  customerDeadlineAt?: number
  returnInstructions?: string
  returnTrackingNumber?: string
  canAppealUntil?: number
  actions: string[]
  items: { name: string; size: string; color: string; image?: string; qtyRequested: number; qtyApproved?: number; qtyReceived: number; inspectionOutcome?: string }[]
  messages: { from: 'you' | 'shop'; body: string; at: number }[]
  timeline: { state: string; at: number }[]
  refunds: { amountMinor: number; status: 'processing' | 'completed'; at: number }[]
  photos: number
}

const money = (minor: number) => formatPrice(minor / 100)

const TONE: Record<string, string> = {
  refunded: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700/90',
  partially_refunded: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700/90',
  resolved: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700/90',
  rejected: 'border-border text-foreground/60',
  cancelled: 'border-border text-foreground/60',
  expired: 'border-border text-foreground/60',
  awaiting_customer_info: 'border-gold/50 bg-gold/10 text-gold',
  awaiting_return_shipment: 'border-gold/50 bg-gold/10 text-gold',
}

function StateBadge({ state }: { state: string }) {
  const { t } = useStore()
  return (
    <span className={cn('inline-flex rounded-lg border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]', TONE[state] ?? 'border-gold/30 bg-gold/5 text-gold')}>
      {t(`refund.state.${state}` as UIKey)}
    </span>
  )
}

export function ReturnsSection({ caseNumber }: { caseNumber: string | null }) {
  return caseNumber ? <CaseView caseNumber={caseNumber} /> : <CaseList />
}

function CaseList() {
  const { t, tf, locale } = useStore()
  const [cases, setCases] = useState<Summary[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch('/api/refunds/cases', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        setCases(((await r.json()) as { cases: Summary[] }).cases)
      })
      .catch(() => setFailed(true))
  }, [])
  if (failed) return <ErrorLine text={t('refund.form.loadError')} />
  if (!cases) return <Spinner />
  if (cases.length === 0) return <p className="max-w-xl text-[14px] font-light text-foreground/70">{t('refund.list.empty')}</p>
  return (
    <ul className="divide-y divide-border border-y border-border">
      {cases.map((c) => (
        <li key={c.caseNumber}>
          <Link
            href={`/account?section=returns&case=${encodeURIComponent(c.caseNumber)}`}
            className="flex min-h-[64px] items-center gap-4 py-4 transition-colors hover:text-foreground"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-foreground">
                {c.caseNumber} · {t(`refund.claim.${c.claimType}` as UIKey)}
              </span>
              <span className="mt-0.5 block text-[12px] font-light text-foreground/60">
                {tf('refund.list.order', { n: c.orderNumber })} · {new Date(c.createdAt).toLocaleDateString(locale)}
                {c.refundedAmountMinor > 0 ? ` · ${money(c.refundedAmountMinor)}` : ''}
              </span>
            </span>
            <StateBadge state={c.state} />
            <ChevronRight aria-hidden className="size-4 shrink-0 text-foreground/40" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function CaseView({ caseNumber }: { caseNumber: string }) {
  const { t, tf, locale } = useStore()
  const [c, setC] = useState<Detail | null>(null)
  const [state, setState] = useState<'loading' | 'missing' | 'failed' | 'ok'>('loading')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [tracking, setTracking] = useState('')
  const [carrier, setCarrier] = useState('')
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/refunds/cases/${encodeURIComponent(caseNumber)}`, { cache: 'no-store' })
      if (r.status === 404) return setState('missing')
      if (!r.ok) throw new Error(String(r.status))
      setC(((await r.json()) as { case: Detail }).case)
      setState('ok')
    } catch {
      setState('failed')
    }
  }, [caseNumber])
  useEffect(() => {
    void load()
  }, [load])

  async function act(command: string, input: Record<string, string> = {}) {
    setBusy(command)
    setActionError(null)
    try {
      const r = await fetch(`/api/refunds/cases/${encodeURIComponent(caseNumber)}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, ...input }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setActionError(t('refund.detail.actionFailed'))
        return
      }
      setC(body.case as Detail)
      setText('')
      setTracking('')
      setCarrier('')
    } catch {
      setActionError(t('refund.detail.actionFailed'))
    } finally {
      setBusy(null)
    }
  }

  const back = (
    <Link href="/account?section=returns" className="mb-6 inline-flex min-h-[44px] items-center gap-1.5 text-[12px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden className="size-3.5" />
      {t('refund.detail.back')}
    </Link>
  )
  if (state === 'loading') return <Spinner />
  if (state === 'missing') return <>{back}<p className="text-[14px] font-light text-foreground/70">{t('refund.detail.notFound')}</p></>
  if (state === 'failed' || !c) return <>{back}<ErrorLine text={t('refund.form.loadError')} /></>

  const can = (a: string) => c.actions.includes(a)
  const textBox = (id: string, label: UIKey) => (
    <>
      <label htmlFor={id} className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {t(label)}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={4000}
        className="mt-2 w-full resize-none rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] font-light text-foreground outline-none focus:border-gold"
      />
    </>
  )
  const button = (command: string, label: UIKey, input: Record<string, string>, disabled = false) => (
    <button
      type="button"
      disabled={disabled || busy !== null}
      onClick={() => void act(command, input)}
      className="tap-safe inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gold px-5 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors enabled:hover:bg-gold/10 disabled:opacity-40"
    >
      {busy === command && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
      {t(label)}
    </button>
  )

  return (
    <div className="max-w-2xl space-y-8">
      {back}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-serif text-[24px] font-normal text-foreground">{c.caseNumber}</h2>
          <StateBadge state={c.state} />
        </div>
        <p className="text-[13px] font-light text-foreground/70">
          {t(`refund.claim.${c.claimType}` as UIKey)} · {tf('refund.list.order', { n: c.orderNumber })} · {date(c.createdAt)}
        </p>
      </header>

      {c.customerDeadlineAt && ['awaiting_customer_info', 'awaiting_return_shipment'].includes(c.state) && (
        <p className="rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 text-[13px] text-foreground">{tf('refund.detail.deadline', { date: date(c.customerDeadlineAt) })}</p>
      )}

      {(c.decisionNote || c.approvedAmountMinor !== undefined || c.refunds.length > 0) && (
        <section>
          <h3 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.detail.decision')}</h3>
          <dl className="grid grid-cols-2 gap-3 text-[13px] font-light sm:grid-cols-3">
            {c.requestedAmountMinor !== undefined && c.requestedAmountMinor > 0 && <Fact label={t('refund.detail.requested')} value={money(c.requestedAmountMinor)} />}
            {c.approvedAmountMinor !== undefined && c.approvedAmountMinor > 0 && <Fact label={t('refund.detail.approvedAmount')} value={money(c.approvedAmountMinor)} />}
            {c.refundedAmountMinor > 0 && <Fact label={t('refund.detail.refunded')} value={money(c.refundedAmountMinor)} />}
          </dl>
          {c.refunds.map((r, i) => (
            <p key={i} className="mt-2 text-[12px] font-light text-foreground/65">
              {money(r.amountMinor)} · {r.status === 'completed' ? t('refund.detail.refundDone') : t('refund.detail.refundProcessing')} · {date(r.at)}
            </p>
          ))}
          {c.decisionNote && <p className="mt-3 whitespace-pre-line rounded-xl border-l-2 border-gold/60 bg-muted/20 px-4 py-3 text-[13px] font-light text-foreground/85">{c.decisionNote}</p>}
        </section>
      )}

      {c.returnInstructions && (
        <section>
          <h3 className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.detail.instructions')}</h3>
          <p className="whitespace-pre-line text-[13px] font-light leading-relaxed text-foreground/85">{c.returnInstructions}</p>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.detail.items')}</h3>
        <ul className="space-y-2">
          {c.items.map((item, i) => (
            <li key={i} className="flex items-center gap-3">
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" className="size-12 rounded-lg object-cover" />
              ) : (
                <span className="size-12 rounded-lg bg-muted/40" />
              )}
              <span className="text-[13px] font-light text-foreground">
                {item.name} · {item.size} · {item.color}
                <span className="block text-[11px] text-foreground/55">
                  {tf('refund.detail.qty', { a: item.qtyRequested, b: item.qtyApproved ?? '—', c: item.qtyReceived })}
                  {item.inspectionOutcome ? ` · ${t(`refund.inspect.${item.inspectionOutcome}` as UIKey)}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {c.photos > 0 && <p className="mt-2 text-[12px] font-light text-foreground/55">{tf('refund.detail.photos', { n: c.photos })}</p>}
      </section>

      {(can('provide_info') || can('add_return_tracking') || can('appeal') || can('customer_message') || can('withdraw')) && (
        <section className="space-y-4 rounded-xl border border-border p-5">
          {can('provide_info') && (
            <div>
              {textBox('refund-answer', 'refund.detail.answer')}
              <div className="mt-3">{button('provide_info', 'refund.detail.sendAnswer', { message: text }, text.trim().length === 0)}</div>
            </div>
          )}
          {can('add_return_tracking') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="refund-tracking" label={t('refund.detail.tracking')} value={tracking} onChange={setTracking} />
              <Field id="refund-carrier" label={t('refund.detail.carrier')} value={carrier} onChange={setCarrier} />
              <div className="sm:col-span-2">{button('add_return_tracking', 'refund.detail.saveTracking', { trackingNumber: tracking, carrier }, tracking.trim().length < 4)}</div>
            </div>
          )}
          {can('appeal') && c.canAppealUntil && (
            <div>
              <p className="mb-2 text-[12px] font-light text-foreground/65">{tf('refund.detail.appealUntil', { date: date(c.canAppealUntil) })}</p>
              {textBox('refund-appeal', 'refund.detail.appealReason')}
              <div className="mt-3">{button('appeal', 'refund.detail.appeal', { reason: text }, text.trim().length < 3)}</div>
            </div>
          )}
          {can('customer_message') && !can('provide_info') && (
            <div>
              {textBox('refund-message', 'refund.detail.writeMessage')}
              <div className="mt-3">{button('customer_message', 'refund.detail.send', { body: text }, text.trim().length === 0)}</div>
            </div>
          )}
          {can('withdraw') && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm(t('refund.detail.withdrawConfirm'))) void act('withdraw')
              }}
              className="text-[12px] font-light text-foreground/60 underline underline-offset-4 hover:text-foreground disabled:opacity-40"
            >
              {t('refund.detail.withdraw')}
            </button>
          )}
          {actionError && <ErrorLine text={actionError} />}
        </section>
      )}

      {c.messages.length > 0 && (
        <section>
          <h3 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.detail.messages')}</h3>
          <ul className="space-y-3">
            {c.messages.map((m, i) => (
              <li key={i} className={cn('rounded-xl px-4 py-3 text-[13px] font-light', m.from === 'you' ? 'ml-8 bg-muted/30' : 'mr-8 border border-gold/30')}>
                <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                  {m.from === 'you' ? t('refund.detail.you') : t('refund.detail.shop')} · {date(m.at)}
                </span>
                <span className="whitespace-pre-line text-foreground/85">{m.body}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.detail.timeline')}</h3>
        <ol className="space-y-2 border-l border-border pl-4">
          {c.timeline.map((e, i) => (
            <li key={i} className="text-[12px] font-light text-foreground/70">
              <span className="text-foreground">{t(`refund.state.${e.state}` as UIKey)}</span> · {date(e.at)}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  )
}

function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={64}
        className="mt-2 min-h-[44px] w-full rounded-xl border border-border bg-card px-3.5 text-[13px] text-foreground outline-none focus:border-gold"
      />
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex min-h-[20vh] items-center justify-center">
      <Loader2 aria-hidden className="size-5 animate-spin text-foreground/70" />
    </div>
  )
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-[13px] font-light text-destructive">
      <AlertCircle className="mt-px size-4 shrink-0" />
      {text}
    </p>
  )
}
