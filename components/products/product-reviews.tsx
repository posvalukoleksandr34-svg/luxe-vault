'use client'

import { BadgeCheck, Loader2, MessageSquare, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Customer reviews on the product page.
 *
 * Every row here is a verified purchase by construction: the RLS policy from
 * migration 0004 only admits a review from someone whose order containing this
 * product reached `delivered`. The badge states a fact about the data rather
 * than making a claim about it.
 *
 * Loaded on the client rather than server-rendered with the rest of the page.
 * Reviews are not part of what a crawler needs to understand the product —
 * the name, price, availability and schema are all in the initial HTML — and
 * fetching them here keeps the page's cache entry (revalidate 600) from being
 * invalidated every time somebody reviews something.
 */

type Review = {
  id: string
  rating: number
  comment?: string
  createdAt: number
  author: string
  verified: boolean
}

type Stats = {
  total: number
  average: number
  breakdown: Record<string, number>
}

const STARS = [5, 4, 3, 2, 1] as const

export function ProductReviews({ productId }: { productId: string }) {
  const { t, locale, currentUser } = useStore()

  const [reviews, setReviews] = useState<Review[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [canReview, setCanReview] = useState(false)
  const [loading, setLoading] = useState(true)

  /** null = every rating. Filtering is client-side: the whole set is already
   *  here, and a round trip to hide four rows would be absurd. */
  const [starFilter, setStarFilter] = useState<number | null>(null)

  const [writing, setWriting] = useState(false)
  const [draftRating, setDraftRating] = useState(5)
  const [draftComment, setDraftComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(productId)}/reviews`)
      if (!res.ok) return
      const data = await res.json()
      setReviews(data.reviews ?? [])
      setStats(data.stats ?? null)
      setCanReview(Boolean(data.canReview))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, currentUser?.id])

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(productId)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: draftRating, comment: draftComment }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(
          data.error === 'ALREADY_REVIEWED'
            ? t('review.already')
            : t('review.notEligible'),
        )
        return
      }

      // Deliberately not optimistic. The review is pending moderation, so
      // showing it in the list immediately would be showing the customer
      // something nobody else can see.
      setSubmitted(true)
      setWriting(false)
      setCanReview(false)
    } finally {
      setSubmitting(false)
    }
  }

  const shown = starFilter ? reviews.filter((r) => r.rating === starFilter) : reviews

  if (loading) {
    return (
      <section className="mt-16 border-t border-border/50 pt-10">
        <div className="flex justify-center py-8">
          <Loader2 className="size-4 animate-spin text-gold" />
        </div>
      </section>
    )
  }

  const total = stats?.total ?? 0

  return (
    <section id="reviews" className="mt-16 scroll-mt-24 border-t border-border/50 pt-10">
      <h2 className="mb-6 font-serif text-2xl font-bold tracking-tight text-foreground">
        {t('review.title')}
      </h2>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <MessageSquare className="size-6 text-muted-foreground/25" strokeWidth={1.25} />
          <p className="text-[13px] font-light text-muted-foreground">{t('review.empty')}</p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
          {/* Summary. The breakdown is the useful part — an average of 4.2
              says much less than "most people gave it five, two gave it one". */}
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-4xl text-gold">
                {stats?.average.toFixed(1)}
              </span>
              <span className="text-[12px] text-muted-foreground">
                / 5 · {total} {t('review.count')}
              </span>
            </div>
            <StarRow value={Math.round(stats?.average ?? 0)} className="mt-2" />

            <div className="mt-5 space-y-1.5">
              {STARS.map((star) => {
                const count = stats?.breakdown?.[String(star)] ?? 0
                const pct = total > 0 ? (count / total) * 100 : 0
                const active = starFilter === star
                return (
                  <button
                    key={star}
                    type="button"
                    // Clicking an empty band would filter to nothing, so it is
                    // not offered.
                    disabled={count === 0}
                    onClick={() => setStarFilter(active ? null : star)}
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-center gap-2 text-left text-[11px] transition-opacity',
                      count === 0 && 'cursor-default opacity-40',
                      active && 'text-gold',
                    )}
                  >
                    <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                      {star}★
                    </span>
                    <span className="h-1 flex-1 bg-border">
                      <span
                        className={cn('block h-1', active ? 'bg-gold' : 'bg-gold/50')}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>

            {starFilter && (
              <button
                type="button"
                onClick={() => setStarFilter(null)}
                className="mt-3 text-[11px] uppercase tracking-[0.1em] text-gold hover:underline"
              >
                {t('review.showAll')}
              </button>
            )}
          </div>

          {/* The reviews themselves */}
          <ul className="space-y-5">
            {shown.map((r) => (
              <li key={r.id} className="border-b border-border/40 pb-5 last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StarRow value={r.rating} />
                  <span className="text-[13px] text-foreground">{r.author}</span>
                  {r.verified && (
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-gold/80">
                      <BadgeCheck className="size-3" />
                      {t('review.verified')}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/60">
                    {new Date(r.createdAt).toLocaleDateString(locale)}
                  </span>
                </div>
                {r.comment && (
                  <p className="mt-2 whitespace-pre-line text-[13px] font-light leading-relaxed text-muted-foreground">
                    {r.comment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Write a review — only for someone who can. */}
      {submitted && (
        <p className="mt-8 border border-gold/40 bg-gold/5 px-4 py-3 text-[13px] font-light text-gold">
          {t('review.pending')}
        </p>
      )}

      {canReview && !submitted && (
        <div className="mt-8 border-t border-border/50 pt-6">
          {!writing ? (
            <button
              type="button"
              onClick={() => setWriting(true)}
              className="border border-gold/40 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
            >
              {t('review.write')}
            </button>
          ) : (
            <div className="max-w-xl space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t('review.yourRating')}
                </span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDraftRating(n)}
                    aria-label={`${n}`}
                    aria-pressed={draftRating === n}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      className={cn(
                        'size-5',
                        n <= draftRating ? 'fill-gold text-gold' : 'text-muted-foreground/40',
                      )}
                    />
                  </button>
                ))}
              </div>

              <textarea
                value={draftComment}
                onChange={(e) => setDraftComment(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder={t('review.placeholder')}
                aria-label={t('review.placeholder')}
                className="w-full border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-gold"
              />

              {error && (
                <p role="alert" className="text-[12px] text-destructive">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWriting(false)
                    setError(null)
                  }}
                  className="border border-border px-5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition hover:text-foreground"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="flex items-center gap-2 border border-gold/40 bg-gold/5 px-6 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:opacity-50"
                >
                  {submitting && <Loader2 className="size-3.5 animate-spin" />}
                  {t('review.submit')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function StarRow({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn('flex items-center gap-0.5', className)}
      role="img"
      aria-label={`${value}/5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            'size-3.5',
            n <= value ? 'fill-gold text-gold' : 'text-muted-foreground/30',
          )}
        />
      ))}
    </span>
  )
}
