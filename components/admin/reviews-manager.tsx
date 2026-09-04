'use client'

import { Check, Star, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Review, ReviewStatus } from '@/lib/types'

const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'На модерации',
  approved: 'Опубликован',
  rejected: 'Отклонён',
}

const STATUS_COLORS: Record<ReviewStatus, string> = {
  pending: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  approved: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  rejected: 'text-red-400 bg-red-400/10 border-red-400/30',
}

/** Lightweight review moderation queue — submissions land here as `pending`
 * (see /api/reviews POST) and only ever reach the public storefront once
 * approved here. */
export function ReviewsManager() {
  const { pushToast } = useStore()
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/reviews')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setReviews(data.reviews ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function updateStatus(id: string, status: ReviewStatus) {
    const previous = reviews
    setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    try {
      const res = await fetch(`/api/admin/reviews/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('failed')
    } catch {
      setReviews(previous)
      pushToast({ title: 'Не удалось обновить отзыв', variant: 'default' })
    }
  }

  async function handleDelete(id: string) {
    setConfirmDeleteId(null)
    const previous = reviews
    setReviews((prev) => prev.filter((r) => r.id !== id))
    try {
      const res = await fetch(`/api/admin/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      pushToast({ title: 'Отзыв удалён', variant: 'default' })
    } catch {
      setReviews(previous)
      pushToast({ title: 'Не удалось удалить отзыв', variant: 'default' })
    }
  }

  const pendingCount = reviews.filter((r) => r.status === 'pending').length

  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-semibold text-foreground">Отзывы</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {pendingCount > 0 ? `${pendingCount} на модерации` : 'Новых отзывов на модерации нет'}
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">Отзывов пока нет</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <div key={review.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{review.name}</p>
                    <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', STATUS_COLORS[review.status])}>
                      {STATUS_LABELS[review.status]}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={cn(
                            'size-3',
                            n <= review.rating ? 'fill-gold text-gold' : 'fill-transparent text-muted-foreground/30',
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(review.createdAt).toLocaleString('ru-RU')}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(review.id)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-destructive"
                  aria-label="Удалить отзыв"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">{review.message}</p>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => updateStatus(review.id, 'approved')}
                  disabled={review.status === 'approved'}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-medium text-emerald-400 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check className="size-3.5" />
                  Одобрить
                </button>
                <button
                  type="button"
                  onClick={() => updateStatus(review.id, 'rejected')}
                  disabled={review.status === 'rejected'}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X className="size-3.5" />
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setConfirmDeleteId(null)}
            aria-hidden
          />
          <div className="animate-fade-up relative w-full max-w-sm border border-border bg-popover p-6 shadow-2xl">
            <h3 className="font-serif text-lg font-bold text-foreground">Удалить отзыв?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Это действие нельзя отменить.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 border border-border py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 border border-destructive/40 bg-destructive/10 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
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
