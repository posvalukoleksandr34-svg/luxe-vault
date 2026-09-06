'use client'

import { Check, ChevronLeft, ChevronRight, Minus, Plus, Ruler, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { STATUS_LABELS } from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

/**
 * Product detail, driven by a `product` prop rather than by store state.
 *
 * Replaces <ProductModal>, which read `activeProduct` from the store. The
 * difference matters beyond layout: a modal has no URL, so a product could not
 * be linked to, shared, or indexed. Everything here is the same interactive
 * surface the modal had — gallery with keyboard and swipe navigation, colour
 * and size selection, size chart, quantity, add-to-cart — mounted under a real
 * route instead.
 *
 * Still a client component: the gallery and the cart are interactive. The page
 * that renders it is a server component, so the product data, metadata and
 * JSON-LD are produced on the server where crawlers can see them.
 */
export function ProductDetail({ product }: { product: Product }) {
  const { addToCart, setPanel, t, localize, categoryLabels } = useStore()

  const p = product
  const [size, setSize] = useState<string | null>(p.sizes.length === 1 ? p.sizes[0] : null)
  const [color, setColor] = useState<string | null>(p.colors[0]?.name ?? null)
  const [qty, setQty] = useState(1)
  const [showGuide, setShowGuide] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const touchStartX = useRef<number | null>(null)

  const allImages = p.images && p.images.length > 0 ? p.images : [p.image]

  const goToIndex = useCallback(
    (index: number) => {
      if (allImages.length === 0) return
      setSelectedIndex(((index % allImages.length) + allImages.length) % allImages.length)
    },
    [allImages.length],
  )
  const goPrev = useCallback(() => goToIndex(selectedIndex - 1), [goToIndex, selectedIndex])
  const goNext = useCallback(() => goToIndex(selectedIndex + 1), [goToIndex, selectedIndex])

  // Arrow keys browse the gallery. Unlike the modal this does NOT lock body
  // scroll — the page is the page, and trapping the scroll would strand anyone
  // trying to reach the footer.
  useEffect(() => {
    if (allImages.length <= 1) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [allImages.length, goPrev, goNext])

  const outOfStock = p.statuses.includes('out_of_stock')
  const selectedImage = allImages[selectedIndex] ?? p.image
  // Only the product's own measurements — never a shared default, which would
  // show every product the same invented numbers.
  const sizeChart = p.sizeChart ?? []
  const productName = localize(p.name)

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const deltaX = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current
    const SWIPE_THRESHOLD = 40
    if (deltaX > SWIPE_THRESHOLD) goPrev()
    else if (deltaX < -SWIPE_THRESHOLD) goNext()
    touchStartX.current = null
  }

  function handleAdd() {
    if (!size || outOfStock) return
    addToCart({
      productId: p.id,
      name: productName,
      image: selectedImage || p.image,
      price: p.price,
      size,
      color: color ?? p.colors[0]?.name ?? '—',
      qty,
    })
    setPanel('cart')
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
      {/* Gallery */}
      <div>
        <div
          className="card-gold group relative aspect-[3/4] overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedImage}
            alt={productName}
            className={cn('size-full object-cover', outOfStock && 'opacity-40 grayscale')}
          />

          {allImages.length > 1 && (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label={t('product.prevImage')}
                className="absolute left-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center border border-border/60 bg-background/60 text-foreground opacity-0 backdrop-blur-md transition-all duration-300 hover:bg-background/90 group-hover:opacity-100"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label={t('product.nextImage')}
                className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center border border-border/60 bg-background/60 text-foreground opacity-0 backdrop-blur-md transition-all duration-300 hover:bg-background/90 group-hover:opacity-100"
              >
                <ChevronRight className="size-4" />
              </button>
            </>
          )}
        </div>

        {allImages.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {allImages.map((imgSrc, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goToIndex(i)}
                className={cn(
                  'no-juice relative size-16 shrink-0 overflow-hidden border transition-all duration-300',
                  i === selectedIndex
                    ? 'border-gold opacity-100'
                    : 'border-transparent opacity-50 hover:opacity-90',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={`${productName} — ${i + 1}`}
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex flex-col">
        <p className="text-[10px] uppercase tracking-[0.25em] text-gold/70">
          {localize(categoryLabels[p.category] ?? {})}
        </p>
        {/* h1, not h2: on a dedicated page the product name is the document's
            heading, and a page whose only h1 is the site name ranks for the
            site name rather than the product. */}
        <h1 className="mt-3 font-serif text-3xl font-light leading-tight text-foreground sm:text-4xl">
          {productName}
        </h1>

        <div className="mt-4 flex items-baseline gap-3">
          <span className="text-xl font-light text-foreground">{formatPrice(p.price)}</span>
          {p.oldPrice && (
            <span className="text-base font-light text-muted-foreground/50 line-through">
              {formatPrice(p.oldPrice)}
            </span>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5">
          {outOfStock && (
            <span className="inline-flex items-center gap-1.5 border border-border/60 px-2.5 py-1 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {t('sold.out')}
            </span>
          )}
          {p.statuses
            .filter((s) => s !== 'out_of_stock')
            .map((s) => (
              <span key={s} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <ShieldCheck className="size-3 text-gold/60" />
                {localize(STATUS_LABELS[s])}
              </span>
            ))}
        </div>

        <p className="mt-6 text-[14px] font-light leading-relaxed text-muted-foreground">
          {localize(p.description)}
        </p>

        {/* Standing replica disclosure, directly beneath the description so it
            reads as part of the product rather than as small print. Rendered
            unconditionally from i18n — the catalogue is Postgres-backed, so a
            disclosure driven by per-product copy would be missing on anything
            added through the admin panel. */}
        <div className="mt-5 border-l-2 border-gold/40 bg-gold/[0.04] py-3 pl-4 pr-3">
          <p className="text-[12px] font-light leading-relaxed text-muted-foreground">
            <span className="mr-1.5 uppercase tracking-[0.15em] text-gold/90">
              {t('product.replicaBadge')}.
            </span>
            {t('product.replicaNotice')}
          </p>
        </div>

        {p.colors.length > 0 && (
          <div className="mt-8">
            <p className="mb-3 text-[11px] uppercase tracking-[0.15em] text-foreground">
              {t('product.color')} —{' '}
              <span className="normal-case tracking-normal text-muted-foreground">{color}</span>
            </p>
            <div className="flex gap-2">
              {p.colors.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setColor(c.name)}
                  className={cn(
                    'no-juice flex size-9 items-center justify-center rounded-full border transition-all duration-200',
                    color === c.name
                      ? 'border-gold ring-1 ring-gold/30 ring-offset-2 ring-offset-background'
                      : 'border-border hover:border-foreground/30',
                  )}
                  style={{ backgroundColor: c.hex }}
                  aria-label={c.name}
                  title={c.name}
                >
                  {color === c.name && (
                    <Check className="size-3.5 text-foreground mix-blend-difference" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.15em] text-foreground">
              {t('product.size')}
            </p>
            {/* Hidden entirely when the product has no measurements — an empty
                guide is worse than no guide. */}
            {sizeChart.length > 0 && (
              <button
                type="button"
                onClick={() => setShowGuide((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-gold/70 transition hover:text-gold"
              >
                <Ruler className="size-3" />
                {t('product.sizeGuide')}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {p.sizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={cn(
                  'min-w-11 border px-3 py-2.5 text-[13px] font-light transition-all duration-200',
                  size === s
                    ? 'border-gold bg-gold/5 text-gold'
                    : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          {!size && <p className="mt-2 text-[11px] text-destructive/80">{t('product.selectSize')}</p>}
        </div>

        {showGuide && (
          <div className="animate-fade-in mt-4 overflow-x-auto border border-border/60">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-accent/50 text-foreground">
                <tr>
                  <th className="px-3 py-2 font-normal">{t('sizeGuide.size')}</th>
                  <th className="px-3 py-2 font-normal">{t('sizeGuide.length')}</th>
                  <th className="px-3 py-2 font-normal">{t('sizeGuide.chest')}</th>
                  <th className="px-3 py-2 font-normal">{t('sizeGuide.shoulder')}</th>
                  <th className="px-3 py-2 font-normal">{t('sizeGuide.sleeve')}</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {sizeChart.map((row) => {
                  const cm = t('sizeGuide.cm')
                  return (
                    <tr key={row.size} className="border-t border-border/40">
                      <td className="px-3 py-2 text-foreground">{row.size}</td>
                      <td className="px-3 py-2">{row.length} {cm}</td>
                      <td className="px-3 py-2">{row.chest} {cm}</td>
                      <td className="px-3 py-2">{row.shoulder} {cm}</td>
                      <td className="px-3 py-2">{row.sleeve} {cm}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 flex items-center gap-3">
          <div className="flex items-center border border-border">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="no-juice flex size-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
              aria-label={t('product.decrease')}
            >
              <Minus className="size-3.5" />
            </button>
            <span className="w-10 text-center text-[13px] font-light tabular-nums text-foreground">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(10, q + 1))}
              className="no-juice flex size-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
              aria-label={t('product.increase')}
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={!size || outOfStock}
          className="mt-4 w-full border border-gold/30 bg-gold/5 py-4 text-[13px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
        >
          {outOfStock ? t('sold.out') : `${t('product.addToCart')} — ${formatPrice(p.price * qty)}`}
        </button>
      </div>
    </div>
  )
}
