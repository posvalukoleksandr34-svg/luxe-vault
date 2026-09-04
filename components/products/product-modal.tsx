'use client'

import { Check, ChevronLeft, ChevronRight, Minus, Plus, Ruler, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SIZE_CHART } from '@/lib/data'
import { CATEGORY_LABELS, STATUS_LABELS } from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function ProductModal() {
  const {
    activeProduct,
    openProduct,
    addToCart,
    setPanel,
    t,
    localize,
  } = useStore()

  const [size, setSize] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [showGuide, setShowGuide] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const touchStartX = useRef<number | null>(null)

  const allImages =
    activeProduct?.images && activeProduct.images.length > 0
      ? activeProduct.images
      : activeProduct
        ? [activeProduct.image]
        : []

  const goToIndex = useCallback(
    (index: number) => {
      if (allImages.length === 0) return
      setSelectedIndex(((index % allImages.length) + allImages.length) % allImages.length)
    },
    [allImages.length],
  )
  const goPrev = useCallback(() => goToIndex(selectedIndex - 1), [goToIndex, selectedIndex])
  const goNext = useCallback(() => goToIndex(selectedIndex + 1), [goToIndex, selectedIndex])

  useEffect(() => {
    if (activeProduct) {
      setSize(activeProduct.sizes.length === 1 ? activeProduct.sizes[0] : null)
      setColor(activeProduct.colors[0]?.name ?? null)
      setQty(1)
      setShowGuide(false)
      setSelectedIndex(0)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [activeProduct])

  // Left/right arrow keys browse the gallery while the modal is open.
  useEffect(() => {
    if (!activeProduct || allImages.length <= 1) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeProduct, allImages.length, goPrev, goNext])

  if (!activeProduct) return null
  const p = activeProduct
  const outOfStock = p.statuses.includes('out_of_stock')
  const discount = p.oldPrice
    ? Math.round((1 - p.price / p.oldPrice) * 100)
    : 0

  const selectedImage = allImages[selectedIndex] ?? p.image
  const sizeChart = p.sizeChart ?? DEFAULT_SIZE_CHART
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
    openProduct(null)
    setPanel('cart')
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div
        className="animate-fade-in absolute inset-0 bg-background/85 backdrop-blur-md"
        onClick={() => openProduct(null)}
        aria-hidden
      />
      <div className="animate-scale-in relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden border border-border bg-popover shadow-2xl sm:max-h-[88vh]">
        <button
          type="button"
          onClick={() => openProduct(null)}
          className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-background/60 text-foreground backdrop-blur-md transition hover:bg-background/90"
          aria-label={t('product.close')}
        >
          <X className="size-[18px]" />
        </button>

        <div className="grid overflow-y-auto md:grid-cols-2">
          {/* Gallery */}
          <div className="flex flex-col bg-card">
            <div
              className="group relative aspect-square w-full overflow-hidden"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={selectedIndex}
                src={selectedImage || p.image || '/placeholder.svg'}
                alt={`${productName} — ${selectedIndex + 1}/${allImages.length}`}
                className="animate-fade-in size-full object-cover"
              />
              {discount > 0 && (
                <span className="absolute left-4 top-4 text-[11px] uppercase tracking-[0.15em] text-destructive">
                  −{discount}%
                </span>
              )}

              {allImages.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    aria-label={t('product.prevImage')}
                    className="absolute left-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center border border-border/60 bg-background/60 text-foreground opacity-0 backdrop-blur-md transition-all duration-300 hover:bg-background/90 group-hover:opacity-100"
                  >
                    <ChevronLeft className="size-[18px]" />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label={t('product.nextImage')}
                    className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center border border-border/60 bg-background/60 text-foreground opacity-0 backdrop-blur-md transition-all duration-300 hover:bg-background/90 group-hover:opacity-100"
                  >
                    <ChevronRight className="size-[18px]" />
                  </button>

                  <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
                    {allImages.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => goToIndex(i)}
                        aria-label={`${i + 1}/${allImages.length}`}
                        className={cn(
                          'h-1 transition-all duration-300',
                          i === selectedIndex ? 'w-5 bg-gold' : 'w-1 bg-background/70 hover:bg-foreground/50',
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {allImages.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto p-3">
                {allImages.map((imgSrc, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => goToIndex(i)}
                    className={cn(
                      'relative size-16 shrink-0 overflow-hidden border transition-all duration-300',
                      i === selectedIndex
                        ? 'border-gold opacity-100'
                        : 'border-transparent opacity-50 hover:opacity-90',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgSrc}
                      alt={`${productName} - ${i + 1}`}
                      className="size-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col p-8 sm:p-10">
            <p className="text-[10px] uppercase tracking-[0.25em] text-gold/70">
              {localize(CATEGORY_LABELS[p.category])}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-light leading-tight text-foreground sm:text-4xl">
              {productName}
            </h2>

            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-xl font-light text-foreground">
                {formatPrice(p.price)}
              </span>
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
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70"
                  >
                    <ShieldCheck className="size-3 text-gold/60" />
                    {localize(STATUS_LABELS[s])}
                  </span>
                ))}
            </div>

            <p className="mt-6 text-[14px] font-light leading-relaxed text-muted-foreground">
              {localize(p.description)}
            </p>

            {/* Color */}
            {p.colors.length > 0 && (
              <div className="mt-8">
                <p className="mb-3 text-[11px] uppercase tracking-[0.15em] text-foreground">
                  {t('product.color')} — <span className="text-muted-foreground normal-case tracking-normal">{color}</span>
                </p>
                <div className="flex gap-2">
                  {p.colors.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setColor(c.name)}
                      className={cn(
                        'flex size-9 items-center justify-center rounded-full border transition-all duration-200',
                        color === c.name
                          ? 'border-gold ring-1 ring-gold/30 ring-offset-2 ring-offset-popover'
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

            {/* Size */}
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.15em] text-foreground">
                  {t('product.size')}
                </p>
                <button
                  type="button"
                  onClick={() => setShowGuide((v) => !v)}
                  className="flex items-center gap-1 text-[11px] text-gold/70 transition hover:text-gold"
                >
                  <Ruler className="size-3" />
                  {t('product.sizeGuide')}
                </button>
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
              {!size && (
                <p className="mt-2 text-[11px] text-destructive/80">
                  {t('product.selectSize')}
                </p>
              )}
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

            {/* Quantity */}
            <div className="mt-8 flex items-center gap-3">
              <div className="flex items-center border border-border">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="flex size-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
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
                  className="flex size-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
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
      </div>
    </div>
  )
}
