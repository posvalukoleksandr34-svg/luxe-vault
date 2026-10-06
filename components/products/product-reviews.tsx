'use client'

import { BadgeCheck, Loader2, LogIn, MessageSquare, ShieldCheck, Star } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { LoadError } from '@/components/load-error'
import { ReviewListSkeleton } from '@/components/skeletons'
import { EmptyState } from '@/components/state-view'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Customer reviews on the product page.
 *
 * Verified buyers only. Every row here is a verified purchase by construction:
 * the database admits a review only from someone with a delivered order
 * containing this product, once per product (migration 0052). The badge
 * states a fact about the data rather than making a claim about it.
 *
 * Below the reviews, what the visitor may do, as the server answers it:
 *   signed out          a link that opens sign-in
 *   signed in, no order a notice that only verified buyers can review
 *   already reviewed    says so
 *   verified buyer      the form
 * The form is never shown to someone the server would refuse, and the server
 * refuses them anyway (401 / 403 / 409) whatever the page shows.
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

/** Where the visitor stands. 'unknown': the server could not tell, so
 *  nothing is offered. */
type Eligibility = 'signed_out' | 'not_purchased' | 'reviewed' | 'eligible' | 'unknown'

const STARS = [5, 4, 3, 2, 1] as const

export function ProductReviews({ productId }: { productId: string }) {
  const { t, locale, currentUser, openAuth } = useStore()

  const [reviews, setReviews] = useState<Review[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [eligibility, setEligibility] = useState<Eligibility>('unknown')
  const [loading, setLoading] = useState(true)
  // A failed request, which must not read as "this product has no reviews".
  const [failed, setFailed] = useState(false)

  /** null = every rating. Filtering is client-side: the whole set is already
   *  here, and a round trip to hide four rows would be absurd. */
  const [starFilter, setStarFilter] = useState<number | null>(null)

  // No stars until the customer picks: a form that arrives at five stars
  // nudges every review towards five.
  const [draftRating, setDraftRating] = useState(0)
  const [draftComment, setDraftComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setFailed(false)
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(productId)}/reviews`)
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setReviews(data.reviews ?? [])
      setStats(data.stats ?? null)
      setEligibility(
        ['signed_out', 'not_purchased', 'reviewed', 'eligible'].includes(data.eligibility)
          ? data.eligibility
          : 'unknown',
      )
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, currentUser?.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    if (draftRating < 1) {
      setError(t('review.ratingRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(productId)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: draftRating, comment: draftComment }),
      })

      if (!res.ok) {
        // The server's answer wins over what the page believed: a session
        // that expired, an order that is not delivered after all, a review
        // sent from another tab. Each switches to the state that explains it.
        // Matched on the API's own codes, so a 403 from anything else in
        // front of it (a firewall, a CSRF refusal) is not taken for one.
        const data = await res.json().catch(() => ({}))
        if (data.error === 'SIGN_IN_REQUIRED') setEligibility('signed_out')
        else if (data.error === 'NOT_VERIFIED_BUYER') setEligibility('not_purchased')
        else if (data.error === 'ALREADY_REVIEWED') setEligibility('reviewed')
        else if (data.error === 'INVALID_RATING') setError(t('review.ratingRequired'))
        else setError(t('review.failed'))
        return
      }

      // Published at once (the automatic filter passed it): reload so it
      // appears in the list. Held for moderation: say so, and do not show it —
      // nobody else can see it yet.
      const data = await res.json().catch(() => ({}))
      setPublished(data.pending === false)
      setSubmitted(true)
      setEligibility('reviewed')
      if (data.pending === false) void load()
    } catch {
      setError(t('review.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const shown = starFilter ? reviews.filter((r) => r.rating === starFilter) : reviews

  if (loading) {
    // The heading is rendered during loading too. Reviews sit below the fold
    // on a long product page, and a bare spinner gave no clue what the reader
    // was scrolling towards.
    return (
      <section className="mt-16 border-t border-border/50 pt-10">
        <h2 className="mb-6 font-serif text-2xl font-bold tracking-tight text-foreground">
          {t('review.title')}
        </h2>
        <ReviewListSkeleton rows={3} label={t('common.loading')} />
      </section>
    )
  }

  const total = stats?.total ?? 0

  return (
    <section id="reviews" className="mt-16 scroll-mt-24 border-t border-border/50 pt-10">
      <h2 className="mb-6 font-serif text-2xl font-bold tracking-tight text-foreground">
        {t('review.title')}
      </h2>

      {failed ? (
        <LoadError
          compact
          title={t('state.reviewsFailed')}
          onRetry={() => {
            setLoading(true)
            return load()
          }}
        />
      ) : total === 0 ? (
        <EmptyState
          compact
          icon={MessageSquare}
          title={t('review.empty')}
          hint={t('state.productReviewsHint')}
        />
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
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-gold">
                      <BadgeCheck className="size-3" />
                      {t('review.verified')}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/85">
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

      {/* Writing a review: verified buyers only. Nothing is offered when the
          list failed to load (the visitor's status comes with it) or when the
          server could not tell who the visitor is. */}
      {!failed && (submitted || eligibility !== 'unknown') && (
        <div
          className={cn(
            'mt-8 border-t border-border/50 pt-6',
            // Under the centred empty state, centred too; under a list, aligned with it.
            total === 0 && 'flex flex-col items-center text-center',
          )}
        >
          {submitted ? (
            <p
              role="status"
              className="rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 text-[13px] font-light text-gold"
            >
              {published ? t('review.published') : t('review.pending')}
            </p>
          ) : eligibility === 'signed_out' ? (
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="tap-safe inline-flex items-center gap-2 text-[13px] text-gold underline decoration-gold/40 underline-offset-4 transition hover:decoration-gold"
            >
              <LogIn className="size-4" strokeWidth={1.5} aria-hidden />
              {t('review.signInToReview')}
            </button>
          ) : eligibility === 'not_purchased' ? (
            <div className="flex max-w-xl items-start gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-left">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gold" strokeWidth={1.5} aria-hidden />
              <div>
                <p className="text-[13px] text-foreground">{t('review.verifiedOnly')}</p>
                <p className="mt-1 text-[12px] font-light leading-relaxed text-muted-foreground">
                  {t('review.verifiedOnlyHint')}
                </p>
              </div>
            </div>
          ) : eligibility === 'reviewed' ? (
            <p className="flex items-center gap-2 text-[13px] font-light text-muted-foreground">
              <BadgeCheck className="size-4 shrink-0 text-gold" strokeWidth={1.5} aria-hidden />
              {t('review.already')}
            </p>
          ) : eligibility === 'eligible' ? (
            <form
              onSubmit={submit}
              noValidate
              aria-labelledby="review-form-title"
              className="w-full max-w-xl space-y-3 text-left"
            >
              <h3
                id="review-form-title"
                className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground"
              >
                {t('review.write')}
              </h3>

              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t('review.yourRating')}
                </span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setDraftRating(n)
                      setError(null)
                    }}
                    aria-label={`${n}/5`}
                    aria-pressed={draftRating === n}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      aria-hidden
                      className={cn(
                        'size-5',
                        n <= draftRating ? 'fill-gold text-gold' : 'text-muted-foreground/85',
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
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-gold"
              />

              {error && (
                <p role="alert" className="text-[12px] text-destructive">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl flex items-center gap-2 border border-transparent bg-gold-gradient px-6 py-2.5 text-[11px] uppercase tracking-[0.12em] font-medium text-gold-foreground transition-all duration-300 hover:brightness-[1.05] disabled:opacity-50 shadow-gold"
              >
                {submitting && <Loader2 className="size-3.5 animate-spin" />}
                {t('review.submit')}
              </button>
            </form>
          ) : null}
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
            n <= value ? 'fill-gold text-gold' : 'text-muted-foreground/85',
          )}
        />
      ))}
    </span>
  )
}
