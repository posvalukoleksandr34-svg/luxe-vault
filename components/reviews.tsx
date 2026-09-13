'use client'

import { MessageSquare, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LoadError } from '@/components/load-error'
import { Reveal } from '@/components/reveal'
import { ReviewListSkeleton } from '@/components/skeletons'
import { EmptyState } from '@/components/state-view'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Review } from '@/lib/types'

export function Reviews() {
  const { t, locale } = useStore()
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // A failed request is not "no reviews" — see LoadError.
  const [failed, setFailed] = useState(false)
  // Bumped by "retry" to run the effect again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetch('/api/reviews')
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setReviews(Array.isArray(data.reviews) ? data.reviews : [])
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  function handleSubmitted(review: Review) {
    // The review is `pending` and not publicly visible yet — no optimistic
    // insert into the list, just close the form with a thank-you state.
    setShowForm(false)
    void review
  }

  return (
    <section id="reviews" className="scroll-mt-20 border-t border-border py-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <Reveal className="mb-12 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 text-[11px] uppercase tracking-[0.4em] text-gold/70">
              {t('reviews.subtitle')}
            </p>
            <h2 className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t('reviews.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="border border-gold/30 bg-gold/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('reviews.writeReview')}
          </button>
        </Reveal>

        {showForm && (
          <Reveal className="mb-12">
            <ReviewForm onSubmitted={handleSubmitted} />
          </Reveal>
        )}

        {loading && <ReviewListSkeleton rows={3} label={t('common.loading')} />}

        {!loading && failed && (
          <LoadError title={t('state.reviewsFailed')} onRetry={() => setAttempt((n) => n + 1)} />
        )}

        {!loading && !failed && reviews.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title={t('reviews.empty')}
            hint={t('state.reviewsHint')}
            action={
              showForm ? undefined : { label: t('reviews.writeReview'), onClick: () => setShowForm(true) }
            }
          />
        )}

        {reviews.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.map((review, i) => (
              <Reveal key={review.id} delay={(i % 6) * 80}>
                <ReviewCard review={review} locale={locale} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ReviewCard({ review, locale }: { review: Review; locale: string }) {
  return (
    <div className="card-gold flex h-full flex-col p-7">
      <StarRating value={review.rating} />
      <p className="mt-5 flex-1 text-[14px] font-light leading-relaxed text-muted-foreground">
        {review.message}
      </p>
      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-foreground">
          {review.name}
        </span>
        <span className="text-[11px] text-muted-foreground/50">
          {new Date(review.createdAt).toLocaleDateString(locale)}
        </span>
      </div>
    </div>
  )
}

function StarRating({
  value,
  onChange,
}: {
  value: number
  onChange?: (v: number) => void
}) {
  const interactive = Boolean(onChange)
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!interactive}
          onClick={() => onChange?.(n)}
          aria-label={`${n}/5`}
          className={cn(!interactive && 'cursor-default')}
        >
          <Star
            className={cn(
              'size-4 transition-colors',
              n <= value ? 'fill-gold text-gold' : 'fill-transparent text-muted-foreground/40',
            )}
          />
        </button>
      ))}
    </div>
  )
}

function ReviewForm({ onSubmitted }: { onSubmitted: (review: Review) => void }) {
  const { t, pushToast } = useStore()
  const [name, setName] = useState('')
  const [rating, setRating] = useState(5)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !message.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), rating, message: message.trim() }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setDone(true)
      setName('')
      setMessage('')
      setRating(5)
      onSubmitted(data.review)
    } catch {
      pushToast({ title: t('reviews.error'), variant: 'default' })
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="border border-gold/30 bg-gold/5 p-6 text-center">
        <p className="text-[13px] font-light text-gold">{t('reviews.submitted')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="panel-gold p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-[11px] uppercase tracking-[0.15em] text-foreground">
            {t('reviews.name')}
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            className="w-full border border-border bg-background px-3 py-2.5 text-[13px] font-light text-foreground outline-none transition focus:border-gold/40"
          />
        </label>
        <div>
          <span className="mb-2 block text-[11px] uppercase tracking-[0.15em] text-foreground">
            {t('reviews.rating')}
          </span>
          <div className="flex h-[42px] items-center">
            <StarRating value={rating} onChange={setRating} />
          </div>
        </div>
      </div>

      <label className="mt-5 block">
        <span className="mb-2 block text-[11px] uppercase tracking-[0.15em] text-foreground">
          {t('reviews.message')}
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={4}
          maxLength={800}
          className="w-full resize-none border border-border bg-background px-3 py-2.5 text-[13px] font-light text-foreground outline-none transition focus:border-gold/40"
        />
      </label>

      <button
        type="submit"
        disabled={submitting || !name.trim() || !message.trim()}
        className="mt-5 border border-gold/30 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
      >
        {t('reviews.submit')}
      </button>
    </form>
  )
}
