'use client'

import { AlertTriangle, ShoppingBag } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { NotifyWhenAvailable } from '@/components/products/notify-dialog'
import { LookActions } from '@/components/stylist/look-actions'
import { Skeleton } from '@/components/ui/skeleton'
import {
  STYLIST_COLOR_LABELS,
  STYLIST_FIT_LABELS,
  STYLIST_OCCASION_LABELS,
  STYLIST_STYLE_LABELS,
} from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Look, LookItem, Reason, Refinement, StylistResult } from '@/lib/stylist/types'
import type { LocalizedText } from '@/lib/types'

/**
 * The look, and the ways to act on it.
 *
 * Editorial rather than conversational: large imagery, a single accent, plenty
 * of air. Every piece carries everything needed to buy it without leaving the
 * page — image, name, price, the sizes that are genuinely available, a link
 * through to the product, and its own add button — because the point of the
 * feature is to sell an outfit, not to give advice.
 */

const REFINEMENTS: { key: Refinement; label: Parameters<ReturnType<typeof useStore>['t']>[0] }[] = [
  { key: 'another', label: 'stylist.tryAnother' },
  { key: 'more_minimal', label: 'stylist.moreMinimal' },
  { key: 'more_streetwear', label: 'stylist.moreStreet' },
  { key: 'cheaper', label: 'stylist.cheaper' },
  { key: 'more_premium', label: 'stylist.morePremium' },
  { key: 'different_colors', label: 'stylist.otherColors' },
]

/**
 * One reason, in the visitor's language.
 *
 * Keys go through the same label maps the consultation uses, so the card
 * under a piece says "Стритвир" on a Russian page and "Streetwear" on an
 * English one — it used to print the raw key on both. `text` reasons are
 * already content (a catalogue colour name, the customer's own word) and are
 * shown as-is.
 */
function reasonLabel(r: Reason, localize: (text: LocalizedText) => string): string {
  switch (r.kind) {
    case 'fit':
      return localize(STYLIST_FIT_LABELS[r.key])
    case 'style':
      return localize(STYLIST_STYLE_LABELS[r.key])
    case 'occasion':
      return localize(STYLIST_OCCASION_LABELS[r.key])
    case 'color':
      return localize(STYLIST_COLOR_LABELS[r.key])
    case 'text':
      return r.text
  }
}

export function LookSkeleton() {
  const { t } = useStore()
  return (
    <div role="status" aria-busy="true" aria-label={t('stylist.loading')}>
      <p className="mb-8 text-[12px] uppercase tracking-[0.25em] text-gold/70">
        {t('stylist.loading')}
      </p>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="aspect-[3/4] w-full" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-8 h-3 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  )
}

export function LookView({
  result,
  busy,
  onRefine,
  onRestart,
}: {
  result: StylistResult
  busy: boolean
  onRefine: (r: Refinement) => void
  onRestart: () => void
}) {
  const { t } = useStore()

  if (!result.looks.length) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <AlertTriangle className="size-8 text-gold/40" strokeWidth={1.25} />
        <p className="text-sm font-light text-foreground">{t('stylist.empty')}</p>
        <p className="max-w-sm text-[12px] font-light leading-relaxed text-muted-foreground/70">
          {result.catalogSize === 0
            ? t('error.loadFailedHint')
            : `${t('stylist.missing')} ${result.missingSlots
                .map((m) => t(`stylist.slot.${m}` as Parameters<typeof t>[0]))
                .join(', ')}`}
        </p>
        <button
          type="button"
          onClick={onRestart}
          className="mt-2 border border-gold/40 bg-gold/5 px-6 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
        >
          {t('stylist.restart')}
        </button>
      </div>
    )
  }

  return (
    <div className={cn('transition-opacity duration-500', busy && 'pointer-events-none opacity-40')}>
      {result.looks.map((look) => (
        <LookBlock
          key={look.id}
          look={look}
          missing={result.missingSlots}
          wantedSizes={result.brief.sizes}
        />
      ))}

      {/* Variations. They re-run the engine with the SAME brief, so nobody is
          asked the six questions twice. */}
      <div className="mt-14 border-t border-border/40 pt-8">
        <div className="flex flex-wrap gap-2.5">
          {REFINEMENTS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onRefine(r.key)}
              disabled={busy}
              className="tap-safe border border-border/60 px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-all duration-300 hover:border-gold/50 hover:text-foreground disabled:opacity-40"
            >
              {t(r.label)}
            </button>
          ))}
          <button
            type="button"
            onClick={onRestart}
            className="tap-safe px-2 py-2.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/50 transition hover:text-foreground"
          >
            {t('stylist.restart')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * One look: its pieces, its total, and every way to act on it.
 *
 * Exported for the shared-capsule page, which passes its own `heading` and the
 * capsule's `savedId` so Save/Share reuse the existing row instead of minting
 * a copy.
 */
export function LookBlock({
  look,
  missing,
  wantedSizes,
  heading,
  savedId,
}: {
  look: Look
  missing: string[]
  /** The sizes the customer asked for — used to offer "notify me" when one of
   *  them is sold out on a piece. */
  wantedSizes?: string[]
  heading?: string
  savedId?: string
}) {
  const { t, localize, addToCart, pushToast } = useStore()
  const [added, setAdded] = useState(false)

  const buyable = look.items.filter((i) => i.suggestedSize !== null)
  const unavailable = look.items.filter((i) => i.suggestedSize === null)

  function addOutfit() {
    for (const item of buyable) {
      addToCart({
        productId: item.product.id,
        // The visitor's locale, like every other add-to-cart on the site.
        // This took the FIRST key of the name object, which is whatever order
        // the database returned — measured, that was `de` — so an outfit
        // added from a Russian page put German names in the cart.
        name: localize(item.product.name) || item.product.category,
        image: item.product.image,
        price: item.product.price,
        qty: 1,
        size: item.suggestedSize!,
        color: item.suggestedColor,
      })
    }
    setAdded(true)
    // One item short is not a failure — say which piece could not be added
    // and let the rest go through, rather than refusing the whole outfit.
    if (unavailable.length) {
      pushToast({
        title: t('stylist.partialAdd'),
        description: unavailable.map((i) => localize(i.product.name)).join(', '),
        variant: 'default',
      })
    }
  }

  return (
    <section className="mt-12 first:mt-0">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {heading ?? (look.kind === 'premium' ? t('stylist.premiumAlt') : t('stylist.yourFit'))}
        </h2>
        <p className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground/60">
          {t('stylist.total')} — <span className="text-gold">{formatPrice(look.total)}</span>
        </p>
      </div>

      {look.relaxed.length > 0 && (
        <p className="mb-6 border-l-2 border-gold/40 bg-gold/[0.04] py-2.5 pl-4 text-[12px] font-light text-muted-foreground">
          {t('stylist.relaxed')}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {look.items.map((item) => (
          <PieceCard key={item.product.id} item={item} wantedSizes={wantedSizes} />
        ))}
      </div>

      {look.rationale && (
        <p className="mt-8 max-w-[60ch] text-[14px] font-light leading-relaxed text-muted-foreground">
          {look.rationale}
        </p>
      )}

      {missing.length > 0 && look.kind === 'primary' && (
        <p className="mt-4 text-[12px] font-light text-muted-foreground/60">
          {t('stylist.missing')}{' '}
          {missing.map((m) => t(`stylist.slot.${m}` as Parameters<typeof t>[0])).join(', ')}
        </p>
      )}

      {/* Primary action first and widest; save and share sit beside it on
          desktop and stack under it on a phone, so "add entire outfit" stays
          the obvious thing to press. */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={addOutfit}
          disabled={buyable.length === 0}
          className="inline-flex w-full items-center justify-center gap-2.5 border border-gold/40 bg-gold/5 px-8 py-4 text-[12px] uppercase tracking-[0.2em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40 sm:w-auto"
        >
          <ShoppingBag className="size-4" />
          {added ? `${t('stylist.addOutfit')} ✓` : `${t('stylist.addOutfit')} — ${formatPrice(look.total)}`}
        </button>
        <LookActions look={look} savedId={savedId} />
      </div>
    </section>
  )
}

function PieceCard({ item, wantedSizes }: { item: LookItem; wantedSizes?: string[] }) {
  const { t, localize, addToCart } = useStore()

  // Sizes the customer asked for that this piece MAKES but cannot sell right
  // now. availableSizes only ever holds buyable sizes, so anything wanted,
  // carried and missing from it is sold out — exactly when "notify me" is
  // worth offering. An untracked product never lands here: all its sizes
  // count as available.
  const wantedSoldOut = (wantedSizes ?? []).filter(
    (s) => item.product.sizes.indexOf(s) !== -1 && item.availableSizes.indexOf(s) === -1,
  )
  const [size, setSize] = useState(item.suggestedSize)
  const name = localize(item.product.name)
  const soldOut = item.availableSizes.length === 0

  return (
    <article className="group">
      <Link
        href={`/product/${encodeURIComponent(item.product.id)}`}
        className="card-gold product-card relative block aspect-[3/4] overflow-hidden"
      >
        <Image
          src={item.product.image}
          alt={name}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 320px"
          className={cn('size-full object-cover', soldOut && 'opacity-40 grayscale')}
        />
        <span className="absolute left-3 top-3 bg-background/85 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-gold backdrop-blur-md">
          {t(`stylist.slot.${item.slot}` as Parameters<typeof t>[0])}
        </span>
      </Link>

      <div className="mt-3">
        <h3 className="font-serif text-[15px] font-medium leading-snug text-foreground">{name}</h3>
        {item.reasons.length > 0 && (
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/50">
            {item.reasons.map((r) => reasonLabel(r, localize)).join(' · ')}
          </p>
        )}
        <p className="mt-1 text-[13px] font-light text-foreground">
          {formatPrice(item.product.price)}
        </p>

        {soldOut ? (
          <>
            <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-destructive/80">
              {t('stylist.unavailable')}
            </p>
            <NotifyWhenAvailable
              variant="compact"
              productId={item.product.id}
              sizes={item.product.sizes}
              color={item.suggestedColor}
              className="mt-2"
            />
          </>
        ) : (
          <>
            {/* Only the sizes this customer can actually buy — the product's
                full size run would promise stock that is not there. */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.availableSizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={cn(
                    'flex size-8 items-center justify-center border text-[11px] transition-colors duration-200',
                    size === s
                      ? 'border-gold bg-gold text-gold-foreground'
                      : 'border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  addToCart({
                    productId: item.product.id,
                    name,
                    image: item.product.image,
                    price: item.product.price,
                    qty: 1,
                    size: size ?? item.availableSizes[0],
                    color: item.suggestedColor,
                  })
                }
                className="border border-gold/30 bg-gold/5 px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
              >
                {t('product.addToCart')}
              </button>
              <Link
                href={`/product/${encodeURIComponent(item.product.id)}`}
                className="tap-safe text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 transition hover:text-foreground"
              >
                {t('stylist.viewProduct')}
              </Link>
            </div>

            {wantedSoldOut.length > 0 && (
              <NotifyWhenAvailable
                variant="compact"
                productId={item.product.id}
                sizes={wantedSoldOut}
                color={item.suggestedColor}
                className="mt-3"
              />
            )}
          </>
        )}
      </div>
    </article>
  )
}
