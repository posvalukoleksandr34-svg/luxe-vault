'use client'

import { BadgeCheck, Link2Off, Loader2, Star } from 'lucide-react'
import Image from 'next/image'
import { useState, type FormEvent } from 'react'

import { Link } from '@/components/locale-link'
import { productImage } from '@/lib/product-image'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Reviewing an order's products from the link in a review-request email.
 *
 * The same honesty rules as the product page (components/products/
 * product-reviews.tsx): no stars until the customer picks — a form that
 * arrives at five nudges every review towards five — and no reward, no
 * pressure, nothing that would make a bad review harder to give.
 */

export type ReviewLinkProduct = { productId: string; name: string; image: string | null; reviewed: boolean }

export type ReviewLinkState =
  | { state: 'ok'; products: ReviewLinkProduct[] }
  | { state: 'expired' }
  | { state: 'not_found' }
  | { state: 'error' }

export function ReviewLinkView({ token, initial }: { token: string; initial: ReviewLinkState }) {
  const { t } = useStore()
  const [products, setProducts] = useState(initial.state === 'ok' ? initial.products : [])
  const [state, setState] = useState(initial.state)

  if (state !== 'ok') {
    const title = state === 'expired' ? t('reviewLink.expiredTitle') : state === 'error' ? t('state.errorTitle') : t('reviewLink.invalidTitle')
    const hint = state === 'expired' ? t('reviewLink.expiredHint') : state === 'error' ? t('state.errorHint') : t('reviewLink.invalidHint')
    return (
      <main id="main" className="flex min-h-[70svh] items-center justify-center bg-background px-6 py-16">
        <div className="flex max-w-md flex-col items-center text-center">
          <Link2Off aria-hidden strokeWidth={1.25} className="size-9 text-gold" />
          <span aria-hidden className="mt-6 h-px w-12 bg-gold" />
          <h1 className="mt-6 font-serif text-2xl tracking-wide text-foreground">{title}</h1>
          {hint && <p className="mt-4 text-sm font-light leading-relaxed text-foreground/80">{hint}</p>}
          <Link href="/" className="mt-8 text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground/80">
            {t('state.goToCatalog')}
          </Link>
        </div>
      </main>
    )
  }

  const allDone = products.length > 0 && products.every((p) => p.reviewed)

  return (
    <main id="main" className="mx-auto w-full max-w-2xl bg-background px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-serif text-3xl tracking-tight text-foreground">{t('reviewLink.title')}</h1>
      <p className="mt-3 text-sm font-light leading-relaxed text-foreground/80">{t('reviewLink.intro')}</p>
      <p className="mt-2 text-[12px] font-light leading-relaxed text-muted-foreground">{t('reviewLink.note')}</p>

      {allDone && (
        <p role="status" className="mt-8 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 text-[13px] font-light text-gold">
          {t('reviewLink.allDone')}
        </p>
      )}

      <ul className="mt-8 space-y-6">
        {products.map((p) => (
          <li key={p.productId} className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
            <ProductReviewForm
              token={token}
              product={p}
              onDone={() => setProducts((list) => list.map((x) => (x.productId === p.productId ? { ...x, reviewed: true } : x)))}
              onLinkGone={(s) => setState(s)}
            />
          </li>
        ))}
      </ul>

      <p className="mt-10 border-t border-border/50 pt-6 text-center">
        <Link href={`/review/${token}/unsubscribe`} className="text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground/80">
          {t('reviewLink.unsubLink')}
        </Link>
      </p>
    </main>
  )
}

function ProductReviewForm({
  token,
  product,
  onDone,
  onLinkGone,
}: {
  token: string
  product: ReviewLinkProduct
  onDone: () => void
  onLinkGone: (state: 'expired' | 'not_found') => void
}) {
  const { t } = useStore()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<'published' | 'pending' | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (rating < 1) {
      setError(t('review.ratingRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/review-requests/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, productId: product.productId, rating, comment }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setResult(data.pending === false ? 'published' : 'pending')
        onDone()
      } else if (data.error === 'ALREADY_REVIEWED') onDone()
      else if (data.error === 'EXPIRED') onLinkGone('expired')
      else if (data.error === 'NOT_FOUND') onLinkGone('not_found')
      else if (data.error === 'INVALID_RATING') setError(t('review.ratingRequired'))
      else setError(t('review.failed'))
    } catch {
      setError(t('review.failed'))
    } finally {
      setBusy(false)
    }
  }

  const formId = `review-${product.productId}`
  return (
    <div>
      <div className="flex items-center gap-3">
        <Image src={productImage(product.image)} alt="" width={56} height={56} className="size-14 shrink-0 rounded-lg object-cover" />
        <h2 id={formId} className="min-w-0 flex-1 text-[14px] font-normal text-foreground">
          {product.name}
        </h2>
        {product.reviewed && !result && (
          <span className="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-gold">
            <BadgeCheck aria-hidden className="size-3.5" />
            {t('reviewLink.reviewed')}
          </span>
        )}
      </div>

      {result ? (
        <p role="status" className="mt-4 text-[13px] font-light text-gold">
          {result === 'published' ? t('review.published') : t('review.pending')}
        </p>
      ) : product.reviewed ? null : (
        <form onSubmit={submit} noValidate aria-labelledby={formId} className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t('review.yourRating')}</span>
            <span className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setRating(n)
                    setError(null)
                  }}
                  aria-label={`${n}/5`}
                  aria-pressed={rating === n}
                  className="tap-safe p-1 transition-transform hover:scale-110"
                >
                  <Star aria-hidden className={cn('size-6', n <= rating ? 'fill-gold text-gold' : 'text-muted-foreground/85')} />
                </button>
              ))}
            </span>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={t('review.placeholder')}
            aria-label={t('review.placeholder')}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-[14px] text-foreground outline-none transition focus:border-gold"
          />
          {error && (
            <p role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-xl border border-transparent bg-gold-gradient px-6 py-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-gold-foreground shadow-gold transition-all duration-300 hover:brightness-[1.05] disabled:opacity-50"
          >
            {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
            {t('review.submit')}
          </button>
        </form>
      )}
    </div>
  )
}
