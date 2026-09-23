'use client'

import { ArrowLeft, Check, Loader2, RotateCcw, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { adminT as t } from '@/lib/admin-i18n'
import type { UIKey } from '@/lib/i18n'
import { formatChf, useStore } from '@/lib/store'
import type { ReturnReason, ReturnRequest, ReturnRequestStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The returns queue, in the admin console's language (Russian, fixed — see
 * lib/admin-i18n.ts).
 *
 * Everything here is display and intent. The decisions themselves — claiming
 * the request, moving the money, telling the customer — happen in
 * /api/admin/returns/[id], in an order chosen so that every failure can be
 * retried. After each one the page is re-read from the server rather than
 * patched locally, so what a manager sees is always what the database says,
 * including a colleague's decision made a moment earlier.
 */

export type ReturnRow = {
  request: ReturnRequest
  /** Ten-minute signed URLs for the private bucket. */
  imageUrls: string[]
  order: {
    id: string
    createdAt: number
    customerName: string
    customerEmail: string
    total: number
    refundedAmount: number
    paymentProvider: string
    paymentStatus: string
    items: {
      key: string
      name: string
      image: string
      size: string
      color: string
      qty: number
      price: number
    }[]
  } | null
}

type Filter = 'all' | ReturnRequestStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Ожидают' },
  { key: 'approved', label: 'Одобрены' },
  { key: 'rejected', label: 'Отклонены' },
  { key: 'completed', label: 'Завершены' },
  { key: 'all', label: 'Все' },
]

const STATUS_BADGE: Record<ReturnRequestStatus, { label: string; className: string }> = {
  pending: { label: 'Ожидает решения', className: 'border-amber-400/30 bg-amber-400/10 text-amber-300' },
  // Approved and not yet completed means the money has NOT moved — the one
  // state a manager must notice, so it is the loudest of the four.
  approved: { label: 'Одобрена · деньги не возвращены', className: 'border-sky-400/40 bg-sky-400/10 text-sky-300' },
  rejected: { label: 'Отклонена', className: 'border-red-400/30 bg-red-400/10 text-red-300' },
  completed: { label: 'Деньги возвращены', className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' },
}

const REASON_LABEL: Record<ReturnReason, UIKey> = {
  wrong_size: 'rma.reason.wrong_size',
  defective: 'rma.reason.defective',
  not_as_described: 'rma.reason.not_as_described',
  changed_mind: 'rma.reason.changed_mind',
  other: 'rma.reason.other',
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ReturnsManager({
  filter,
  counts,
  rows,
}: {
  filter: Filter
  counts: Record<Filter, number>
  rows: ReturnRow[]
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href="/admin"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Панель управления
      </Link>

      <h1 className="mb-2 font-serif text-2xl font-semibold text-foreground">Возвраты</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Заявки покупателей. Деньги возвращаются только после вашего решения: «Одобрить и вернуть»
        проводит возврат через Stripe, оплату криптовалютой нужно вернуть вручную и затем отметить.
      </p>

      {/* Links, not buttons: the filter is in the address, so a tab can be
          bookmarked, shared with a colleague, and survives a refresh. */}
      <nav className="mb-8 flex flex-wrap gap-2" aria-label="Фильтр заявок">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'pending' ? '/admin/returns' : `/admin/returns?status=${f.key}`}
            aria-current={filter === f.key ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition',
              filter === f.key
                ? 'border-gold/50 bg-gold/10 text-gold'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            <span className="tabular-nums text-xs opacity-70">{counts[f.key]}</span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
          {filter === 'pending' ? 'Новых заявок нет.' : 'В этом разделе заявок нет.'}
        </p>
      ) : (
        <ul className="space-y-6">
          {rows.map((row) => (
            <li key={row.request.id}>
              <ReturnCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReturnCard({ row }: { row: ReturnRow }) {
  const { request, order, imageUrls } = row
  const router = useRouter()
  const { pushToast } = useStore()

  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'complete'>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const badge = STATUS_BADGE[request.status]
  const byCard = order?.paymentProvider === 'stripe'

  async function decide(decision: 'approve' | 'reject' | 'complete') {
    if (busy) return
    if (decision === 'approve') {
      // A refund cannot be taken back. One confirmation, naming the amount.
      const amount = order ? formatChf(order.total - order.refundedAmount) : ''
      const question = byCard
        ? `Вернуть ${amount} по заказу ${request.orderNumber} через Stripe?`
        : `Одобрить возврат по заказу ${request.orderNumber}? Деньги нужно будет вернуть вручную.`
      if (!window.confirm(question)) return
    }
    if (decision === 'complete' && !window.confirm(`Подтвердите: деньги по заказу ${request.orderNumber} уже возвращены вручную.`)) {
      return
    }

    setBusy(decision)
    setError(null)
    try {
      const res = await fetch(`/api/admin/returns/${encodeURIComponent(request.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          decision === 'reject' ? { decision, adminNotes: note.trim() } : { decision },
        ),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Не удалось сохранить решение')
        // A refund that failed has still been APPROVED — refresh so the card
        // shows that state and its retry button, not a stale "pending".
        if (data?.retryable) router.refresh()
        return
      }

      pushToast({
        title:
          decision === 'reject'
            ? 'Заявка отклонена, покупатель уведомлён'
            : data?.manual
              ? 'Одобрено — верните деньги вручную и отметьте'
              : 'Деньги возвращены, покупатель уведомлён',
        variant: 'success',
      })
      setRejecting(false)
      setNote('')
      router.refresh()
    } catch {
      setError('Сеть недоступна — решение не отправлено')
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-foreground">{request.orderNumber}</p>
          <p className="mt-1 text-xs text-muted-foreground">Заявка от {formatDate(request.createdAt)}</p>
        </div>
        <span className={cn('rounded-full border px-3 py-1 text-xs', badge.className)}>{badge.label}</span>
      </header>

      <div className="mt-5 grid gap-6 md:grid-cols-2">
        {/* What the customer says. */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Причина</h2>
          <p className="mt-1.5 text-sm font-medium text-foreground">{t(REASON_LABEL[request.reason])}</p>

          <h2 className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Комментарий покупателя</h2>
          <p className="mt-1.5 whitespace-pre-line text-sm text-foreground/85">
            {request.comment || <span className="text-muted-foreground">— без комментария —</span>}
          </p>

          {imageUrls.length > 0 && (
            <>
              <h2 className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
                Фото ({imageUrls.length})
              </h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {imageUrls.map((url, i) => (
                  // A plain <img>, not next/image: these are short-lived signed
                  // URLs to a private bucket, and routing them through the
                  // optimiser would cache a copy that outlives the signature.
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Фото ${i + 1}`}
                      className="size-20 rounded-md border border-border object-cover transition hover:opacity-80"
                    />
                  </a>
                ))}
              </div>
            </>
          )}

          {request.adminNotes && (
            <>
              <h2 className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Заметка менеджера</h2>
              <p className="mt-1.5 whitespace-pre-line text-sm text-foreground/85">{request.adminNotes}</p>
            </>
          )}
        </section>

        {/* What the order was. */}
        <section className="rounded-lg bg-muted/30 p-4">
          {order ? (
            <>
              <p className="text-sm text-foreground">{order.customerName}</p>
              {order.customerEmail && <p className="text-xs text-muted-foreground">{order.customerEmail}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                Заказ от {formatDate(order.createdAt)} · {byCard ? 'карта (Stripe)' : order.paymentProvider || 'оплата'}
              </p>

              <ul className="mt-3 space-y-2">
                {order.items.map((item) => (
                  <li key={item.key} className="flex items-center gap-3">
                    {item.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image} alt="" className="size-10 rounded object-cover" />
                    )}
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="truncate text-foreground">{item.name}</p>
                      <p className="text-muted-foreground">
                        {item.size} · {item.color} · ×{item.qty}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-foreground">{formatChf(item.price * item.qty)}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">Итого</span>
                <span className="tabular-nums text-foreground">{formatChf(order.total)}</span>
              </div>
              {order.refundedAmount > 0 && (
                <div className="mt-1 flex justify-between text-xs text-emerald-300">
                  <span>Уже возвращено</span>
                  <span className="tabular-nums">{formatChf(order.refundedAmount)}</span>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Заказ не найден.</p>
          )}
        </section>
      </div>

      {/* Actions — only for the states that have one. */}
      {(request.status === 'pending' || request.status === 'approved') && order && (
        <footer className="mt-6 border-t border-border pt-5">
          {rejecting ? (
            <div>
              <label htmlFor={`note-${request.id}`} className="text-xs uppercase tracking-wider text-muted-foreground">
                Причина отказа — её увидит покупатель
              </label>
              <textarea
                id={`note-${request.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={2000}
                autoFocus
                placeholder="Например: на фото видны следы носки, бирки отрезаны."
                className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void decide('reject')}
                  disabled={busy !== null || note.trim().length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-500/90 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-40"
                >
                  {busy === 'reject' ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                  Подтвердить отказ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejecting(false)
                    setNote('')
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                  Назад
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {/* Approved-but-unpaid by card: the refund failed last time, and
                  approving again retries only the refund. */}
              {(request.status === 'pending' || (request.status === 'approved' && byCard)) && (
                <button
                  type="button"
                  onClick={() => void decide('approve')}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-gold-foreground transition hover:bg-gold/90 disabled:opacity-40"
                >
                  {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  {request.status === 'approved'
                    ? 'Повторить возврат'
                    : byCard
                      ? 'Одобрить и вернуть'
                      : 'Одобрить'}
                </button>
              )}

              {request.status === 'approved' && !byCard && (
                <button
                  type="button"
                  onClick={() => void decide('complete')}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
                >
                  {busy === 'complete' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Деньги возвращены вручную
                </button>
              )}

              {/* A decision is final once made: rejecting is offered only while
                  the request is still pending. */}
              {request.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => setRejecting(true)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-400/40 px-4 py-2 text-sm text-red-300 transition hover:bg-red-400/10 disabled:opacity-40"
                >
                  <X className="size-4" />
                  Отклонить
                </button>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </footer>
      )}
    </article>
  )
}
