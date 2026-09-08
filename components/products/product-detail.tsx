'use client'

import { Check, ChevronLeft, ChevronRight, Minus, Plus, Ruler, ShieldCheck, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rememberViewed } from '@/components/products/product-rail'
import { StockAlert } from '@/components/products/stock-alert'
import { trackViewItem } from '@/lib/analytics'
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

  const activeColor = p.colors.find((c) => c.name === color)
  // A colour with its own photo puts it first, so selecting "Charcoal" shows
  // the charcoal one rather than leaving the customer to hunt the carousel.
  const allImages = (() => {
    const base = p.images && p.images.length > 0 ? p.images : [p.image]
    const variant = activeColor?.image?.trim()
    if (!variant) return base
    return [variant, ...base.filter((img) => img !== variant)]
  })()

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

  /**
   * Availability, from the variants table when this product is tracked.
   *
   * `tracked` is the load-bearing distinction: a product with no variant rows
   * is one whose stock nobody is counting, not one that has sold out. Reading
   * absent as zero would black out the entire catalogue.
   */
  const tracked = Boolean(p.variants?.length)

  const stockFor = useCallback(
    (sizeName: string | null, colorName: string | null): number | undefined => {
      if (!tracked || !sizeName || !colorName) return undefined
      // A tracked product with no row for this combination has none of it —
      // which is also how place_order() treats it, so the button and the
      // database agree.
      return p.variants?.find((v) => v.size === sizeName && v.color === colorName)?.stock ?? 0
    },
    [tracked, p.variants],
  )

  // Colour-level stock is summed across sizes upstream; `undefined` means
  // untracked, so only an explicit 0 marks a colour sold out.
  const colorSoldOut = activeColor?.stock === 0
  const selectedStock = stockFor(size, color)
  const selectedVariant = tracked
    ? p.variants?.find((v) => v.size === size && v.color === color)
    : undefined

  const outOfStock =
    p.statuses.includes('out_of_stock') || colorSoldOut || selectedStock === 0

  // Never offer more than exists. 10 stays the ceiling for untracked products
  // and is the previous behaviour.
  const maxQty = selectedStock === undefined ? 10 : Math.min(10, selectedStock)

  // Switching to a size with less on hand must not carry a now-impossible
  // quantity across with it.
  useEffect(() => {
    setQty((q) => Math.min(q, Math.max(1, maxQty)))
  }, [maxQty])
  const selectedImage = allImages[selectedIndex] ?? p.image
  // Only the product's own measurements — never a shared default, which would
  // show every product the same invented numbers.
  const sizeChart = p.sizeChart ?? []
  const productName = localize(p.name)

  // One view_item per product, not per render. The dependency is the id
  // rather than the object so a catalogue refresh does not re-fire it.
  useEffect(() => {
    trackViewItem(p, productName)
    // Local history for the "recently viewed" rail. Separate from the
    // analytics event above: this one never leaves the browser.
    rememberViewed(p.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id])

  /**
   * Mobile sticky buy bar.
   *
   * The product page is long — gallery, colours, sizes, size guide, delivery
   * and returns copy — so on a phone the only button that matters scrolls out
   * of view within a screen and never comes back until the customer scrolls up
   * hunting for it.
   *
   * The bar appears only once the real button has been scrolled PAST — not
   * merely while it is off-screen. The button sits ~1200px down, so on load it
   * is already outside the viewport, and showing the bar then would cover the
   * gallery to advertise a control the customer has not reached yet.
   *
   * Measured from the button's own position rather than a scroll offset: the
   * page height varies with the size guide and the colour list, so any fixed
   * threshold would be wrong on most products.
   *
   * NOT an IntersectionObserver. That only fires when a threshold is crossed,
   * and a fast fling, a jump link or a restored scroll position can take the
   * button from below the viewport to above it without ever intersecting — no
   * crossing, no callback, and the bar never appears. A passive scroll
   * listener reading the rect is always correct, and rAF-throttling keeps it
   * to one measurement per frame.
   */
  const buyButtonRef = useRef<HTMLButtonElement>(null)
  const [showStickyBuy, setShowStickyBuy] = useState(false)

  const [zoomed, setZoomed] = useState(false)

  // Escape closes the lightbox, and the page behind it must not scroll while
  // it is open — a zoomed image that slides away under the overlay is the
  // classic broken lightbox.
  useEffect(() => {
    if (!zoomed) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setZoomed(false)
    }
    window.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [zoomed])

  // The exact unit being bought, when the product is tracked. Shown next to
  // the price because a customer contacting support about "the black one in
  // medium" is far harder to help than one quoting a code.
  const sku = selectedVariant?.sku

  useEffect(() => {
    let frame = 0

    function measure() {
      frame = 0
      const el = buyButtonRef.current
      if (!el) return
      // Fully above the viewport's top edge: scrolled past, so offer it again.
      setShowStickyBuy(el.getBoundingClientRect().bottom < 0)
    }

    function onScroll() {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

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
          {/* The LCP element on every product page — hence `priority`, which
              preloads it instead of waiting for the image to be discovered
              during layout.

              Click-to-zoom rather than hover-magnifier: a magnifier needs a
              pointer, so it does nothing on the half of traffic that is a
              phone, and it fights the swipe gesture on the rest. */}
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label={t('product.zoom')}
            className="no-juice absolute inset-0 z-10 cursor-zoom-in"
          />
          <Image
            src={selectedImage}
            alt={productName}
            fill
            sizes="(max-width: 1024px) 100vw, 560px"
            priority
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
                <Image
                  src={imgSrc}
                  alt={`${productName} — ${i + 1}`}
                  fill
                  sizes="64px"
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

        {/* Brand and SKU. The brand is always Luxe Vault — never the designer
            name an item imitates, which is the same line the JSON-LD, the
            replica badge and the Terms all hold. The SKU appears only when the
            product is tracked and a code has been entered. */}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60">
          <span>{t('product.brand')}: Luxe Vault</span>
          {sku && (
            <>
              <span aria-hidden className="text-muted-foreground/30">
                ·
              </span>
              <span className="font-mono normal-case tracking-normal">SKU {sku}</span>
            </>
          )}
        </p>

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
              {/* The low-stock count now sits under the size picker, where it
                  refers to the exact variant being bought. A colour-level
                  total shown here as well contradicted it — "3 left" beside
                  the swatch and "1 left" under the size. */}
            </p>
            <div className="flex gap-2">
              {p.colors.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => {
                    setColor(c.name)
                    // Back to the first image, which is now this colour's own.
                    setSelectedIndex(0)
                  }}
                  className={cn(
                    'no-juice relative flex size-9 items-center justify-center rounded-full border transition-all duration-200',
                    color === c.name
                      ? 'border-gold ring-1 ring-gold/30 ring-offset-2 ring-offset-background'
                      : 'border-border hover:border-foreground/30',
                    // Still selectable when sold out: the customer needs to be
                    // able to look at it and see why they cannot buy it.
                    c.stock === 0 && 'opacity-40',
                  )}
                  style={{ backgroundColor: c.hex }}
                  aria-label={c.stock === 0 ? `${c.name} — ${t('sold.out')}` : c.name}
                  title={c.stock === 0 ? `${c.name} — ${t('sold.out')}` : c.name}
                >
                  {c.stock === 0 && (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-1/2 h-px -rotate-45 bg-foreground/70"
                    />
                  )}
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
            {p.sizes.map((s) => {
              // Struck through and unclickable rather than hidden: a customer
              // looking for their size needs to see that it exists and is gone,
              // not silently find a shorter list.
              const soldOut = stockFor(s, color) === 0
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  disabled={soldOut}
                  aria-label={soldOut ? `${s} — ${t('sold.out')}` : s}
                  title={soldOut ? `${s} — ${t('sold.out')}` : undefined}
                  className={cn(
                    'min-w-11 border px-3 py-2.5 text-[13px] font-light transition-all duration-200',
                    size === s
                      ? 'border-gold bg-gold/5 text-gold'
                      : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                    soldOut &&
                      'cursor-not-allowed border-border/40 text-muted-foreground/40 line-through hover:border-border/40 hover:text-muted-foreground/40',
                  )}
                >
                  {s}
                </button>
              )
            })}
          </div>
          {!size && <p className="mt-2 text-[11px] text-destructive/80">{t('product.selectSize')}</p>}
          {/* Only when tracked AND actually low — a permanent counter on a
              well-stocked item is noise and manufactured urgency. */}
          {selectedVariant &&
            selectedVariant.stock > 0 &&
            selectedVariant.stock <= selectedVariant.lowStockAt && (
              <p className="mt-2 text-[11px] text-gold/80">
                {t('product.lowStock')} {selectedVariant.stock}
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
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              disabled={qty >= maxQty}
              className="no-juice flex size-11 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('product.increase')}
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAdd}
          ref={buyButtonRef}
          disabled={!size || outOfStock}
          className="mt-4 w-full border border-gold/30 bg-gold/5 py-4 text-[13px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
        >
          {outOfStock ? t('sold.out') : `${t('product.addToCart')} — ${formatPrice(p.price * qty)}`}
        </button>

        {/* Offered only where the disappointment happens: a tracked variant the
            customer has actually chosen, which has none left. */}
        {tracked && size && color && selectedStock === 0 && (
          <StockAlert productId={p.id} size={size} color={color} />
        )}
      </div>

      {/* Specifications. Composition, care, dimensions — the details someone
          checks before spending CHF 400, and the ones that reduce returns when
          they are there. Hidden entirely when empty: an empty table is worse
          than no table. */}
      {p.specs && p.specs.length > 0 && (
        <section className="lg:col-span-2">
          <h2 className="mb-4 mt-12 font-serif text-2xl font-bold tracking-tight text-foreground">
            {t('product.specs')}
          </h2>
          <dl className="max-w-2xl divide-y divide-border/40 border-y border-border/40">
            {p.specs.map((spec) => (
              <div key={spec.label} className="flex gap-4 py-3">
                <dt className="w-40 shrink-0 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                  {spec.label}
                </dt>
                <dd className="text-[13px] font-light text-foreground">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Full-screen image. Rendered outside the gallery box so it is not
          clipped by its overflow-hidden. */}
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={productName}
          onClick={() => setZoomed(false)}
          className="animate-fade-in fixed inset-0 z-[130] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label={t('product.closeZoom')}
            className="absolute right-4 top-4 flex size-10 items-center justify-center border border-border/60 bg-background/60 text-foreground transition hover:bg-background/90"
          >
            <X className="size-4" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedImage}
            alt={productName}
            // Deliberately NOT next/image: the point of this view is the
            // original at full resolution, and the optimiser would serve a
            // viewport-sized copy — exactly what the customer opened it to
            // get past.
            className="max-h-full max-w-full cursor-zoom-out object-contain"
          />
        </div>
      )}

      {/* Sticky buy bar — phones only; on a laptop the button is rarely far
          away and a permanent bar would just eat viewport. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-popover/95 px-4 py-3 backdrop-blur-md transition-transform duration-300 sm:hidden',
          showStickyBuy ? 'translate-y-0' : 'translate-y-full',
        )}
        // Hidden from assistive technology while off-screen: the real button
        // is still in the document, and announcing two "add to cart" controls
        // would be confusing rather than helpful.
        aria-hidden={!showStickyBuy}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-light text-foreground">{productName}</p>
            <p className="text-[13px] text-gold">{formatPrice(p.price * qty)}</p>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!size || outOfStock}
            tabIndex={showStickyBuy ? 0 : -1}
            className="shrink-0 border border-gold/40 bg-gold/10 px-6 py-3 text-[12px] uppercase tracking-[0.12em] text-gold transition-all duration-300 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
          >
            {outOfStock ? t('sold.out') : !size ? t('product.selectSize') : t('product.addToCart')}
          </button>
        </div>
      </div>
    </div>
  )
}
