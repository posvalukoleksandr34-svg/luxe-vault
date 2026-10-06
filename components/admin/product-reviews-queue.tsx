'use client'

import { Check, ExternalLink, Loader2, RefreshCw, ShieldAlert, Star, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Product reviews held by the automatic filter (lib/server/review-moderation.ts).
 *
 * Only the quarantine is listed: a 4–5 star review with nothing flagged is
 * already live and never appears here. Each card says why it was held.
 * Approving publishes it; rejecting hides it for good (the customer cannot
 * post another for that product); deleting removes it and lets them write
 * again.
 */

type Flag = 'low_rating' | 'profanity' | 'contact_or_link' | 'spam' | 'gibberish'

type PendingReview = {
  id: string
  productId: string
  productName: string
  rating: number
  comment?: string
  createdAt: number
  authorName: string
  authorEmail: string
  orderNumber?: string
  flags: Flag[]
}

const FLAG_LABELS: Record<Flag, string> = {
  low_rating: 'Оценка 1–3',
  profanity: 'Нецензурная лексика',
  contact_or_link: 'Ссылка или контакты',
  spam: 'Похоже на спам',
  gibberish: 'Бессмысленный текст',
}

/** Rating alone is amber (usually fine to publish); content problems are red. */
const FLAG_TONE: Record<Flag, string> = {
  low_rating: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
  profanity: 'border-red-500/30 bg-red-500/10 text-red-700',
  contact_or_link: 'border-red-500/30 bg-red-500/10 text-red-700',
  spam: 'border-red-500/30 bg-red-500/10 text-red-700',
  gibberish: 'border-red-500/30 bg-red-500/10 text-red-700',
}

type Action = 'approved' | 'rejected' | 'delete'

export function ProductReviewsQueue() {
  const { pushToast } = useStore()
  const [reviews, setReviews] = useState<PendingReview[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PendingReview | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch('/api/admin/product-reviews', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setReviews(data.reviews ?? [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(review: PendingReview, action: Action) {
    setConfirmDelete(null)
    setBusy(review.id)
    try {
      const url = `/api/admin/product-reviews/${encodeURIComponent(review.id)}`
      const res =
        action === 'delete'
          ? await fetch(url, { method: 'DELETE' })
          : await fetch(url, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: action }),
            })
      // 404: someone else already handled it. Either way it leaves the queue.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status))
      setReviews((prev) => prev.filter((r) => r.id !== review.id))
      pushToast({
        title: action === 'approved' ? 'Отзыв опубликован' : action === 'rejected' ? 'Отзыв отклонён' : 'Отзыв удалён',
        variant: 'default',
      })
    } catch {
      pushToast({ title: 'Не удалось выполнить действие. Попробуйте ещё раз.', variant: 'default' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Отзывы о товарах</h1>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Обновить
        </button>
      </div>
      <p className="mb-2 text-sm text-muted-foreground">
        {loading
          ? 'Загрузка…'
          : reviews.length > 0
            ? `${reviews.length} ${plural(reviews.length, 'отзыв ждёт', 'отзыва ждут', 'отзывов ждут')} проверки`
            : 'Очередь пуста — все отзывы проверены'}
      </p>
      <div className="mb-6 max-w-3xl space-y-1 rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <p>
          Отзывы с оценкой 4–5 без нарушений публикуются автоматически и сюда не попадают. Здесь — те, что
          фильтр отложил, с причиной.
        </p>
        <p>
          <strong className="font-medium text-foreground">Публикуйте и низкие оценки</strong>, если в отзыве нет
          мата, спама или ссылок. Скрывать отзыв только потому, что он негативный, нельзя: это вводит покупателей
          в заблуждение (недобросовестная практика по законам ЕС и Швейцарии).
        </p>
        <p>«Отклонить» — отзыв скрыт, повторно покупатель написать не сможет. «Удалить» — отзыв удалён, покупатель сможет написать новый.</p>
      </div>

      {failed ? (
        <p className="text-sm text-destructive">Не удалось загрузить отзывы.</p>
      ) : loading && reviews.length === 0 ? null : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={`/product/${encodeURIComponent(review.productId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-foreground hover:text-gold"
                  >
                    {review.productName}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex gap-0.5" role="img" aria-label={`${review.rating} из 5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          aria-hidden
                          className={cn('size-3', n <= review.rating ? 'fill-gold text-gold' : 'text-muted-foreground/85')}
                        />
                      ))}
                    </span>
                    <span>{new Date(review.createdAt).toLocaleString('ru-RU')}</span>
                    <span className="break-all">
                      {review.authorName}
                      {review.authorEmail ? ` · ${review.authorEmail}` : ''}
                    </span>
                    {review.orderNumber && <span>Заказ {review.orderNumber}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {review.flags.map((flag) => (
                    <span
                      key={flag}
                      className={cn('flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', FLAG_TONE[flag])}
                    >
                      {flag !== 'low_rating' && <ShieldAlert className="size-3" aria-hidden />}
                      {FLAG_LABELS[flag]}
                    </span>
                  ))}
                </div>
              </div>

              <p className="mt-3 whitespace-pre-line break-words text-sm text-foreground/90">
                {review.comment || <span className="italic text-muted-foreground">Без текста, только оценка</span>}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void act(review, 'approved')}
                  disabled={busy === review.id}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {busy === review.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  Опубликовать
                </button>
                <button
                  type="button"
                  onClick={() => void act(review, 'rejected')}
                  disabled={busy === review.id}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-3.5" />
                  Отклонить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(review)}
                  disabled={busy === review.id}
                  className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-[12px] font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-review-title">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} aria-hidden />
          <div className="animate-fade-up relative w-full max-w-sm rounded-2xl border border-border bg-popover p-6 shadow-2xl">
            <h3 id="delete-review-title" className="font-serif text-lg font-bold text-foreground">
              Удалить отзыв?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Это нельзя отменить. Покупатель сможет написать новый отзыв об этом товаре.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void act(confirmDelete, 'delete')}
                className="flex-1 rounded-lg border border-destructive/40 bg-destructive/10 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
