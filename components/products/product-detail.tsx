'use client'

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Ruler,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react'
import Image from 'next/image'
import { Link } from '@/components/locale-link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rememberViewed } from '@/components/products/product-rail'
import { FitAdvisorModal } from '@/components/products/fit-advisor-modal'
import { HurryDot } from '@/components/products/hurry-dot'
import { resolveTags } from '@/lib/stylist/tagging'
import { NotifyWhenAvailable } from '@/components/products/notify-dialog'
import { WaitlistForm } from '@/components/products/waitlist-form'
import { DiscountBadge, discountPercent } from '@/components/products/discount-badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { useAudioFeedback } from '@/hooks/use-audio-feedback'
import { trackViewItem } from '@/lib/analytics'
import { describeProductDelivery } from '@/lib/fulfilment'
import { STATUS_LABELS } from '@/lib/i18n'
import { canShareNatively, copyText, shareNatively } from '@/lib/share'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { PRODUCT_PLACEHOLDER } from '@/lib/product-image'
import type { Product } from '@/lib/types'

/**
 * The return window, in days. The same figure the returns policy states
 * ("help.returns.content": 14 days from receipt) — keep the two in step.
 */
const RETURN_DAYS = 14

/**
 * The gallery arrows. z-20 puts them ABOVE the full-photo click-to-zoom
 * button (z-10): without it that button covered them, so every arrow click
 * opened the lightbox instead of changing the photo. Always visible where
 * there is no hover (touch screens) and on keyboard focus.
 */
const GALLERY_ARROW =
  'no-juice absolute top-1/2 z-20 flex size-9 -translate-y-1/2 items-center justify-center border border-border/60 bg-background/60 text-foreground opacity-0 backdrop-blur-md transition-all duration-300 hover:bg-background/90 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:size-11 [@media(hover:none)]:opacity-100'

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
  const { addToCart, setPanel, t, tf, locale, localize, categoryLabels, pushToast, shipping } = useStore()
  const { playHoverSound, playClickSound } = useAudioFeedback()

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
    // Empty entries dropped, and the placeholder when nothing is left: a
    // product saved without photos must not break the page.
    const listed = (p.images && p.images.length > 0 ? p.images : [p.image]).filter((src) => Boolean(src && src.trim()))
    const base = listed.length > 0 ? listed : [PRODUCT_PLACEHOLDER]
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

  /**
   * Availability in the SELECTED size, in words: "Disponibile nella taglia L",
   * "Solo 2 pezzi disponibili nella taglia L", "Esaurito nella taglia L".
   * Null until a size is chosen — the general status shows until then. A
   * one-size product has no size worth naming, so its wording leaves it out.
   */
  const namesSize = p.sizes.length > 1
  const lowCount =
    selectedVariant && selectedVariant.stock > 0 && selectedVariant.stock <= selectedVariant.lowStockAt
      ? selectedVariant.stock
      : null
  const sizeSoldOut = Boolean(size) && selectedStock === 0
  const sizeStatus: string | null =
    !size || p.statuses.includes('out_of_stock') || colorSoldOut
      ? null
      : sizeSoldOut
        ? namesSize
          ? tf('stock.soldOutInSize', { size })
          : t('sold.out')
        : namesSize
          ? tf('stock.availableInSize', { size })
          : null
  const lowStockText =
    lowCount === null || !size
      ? null
      : namesSize
        ? tf(lowCount === 1 ? 'stock.lowInSizeOne' : 'stock.lowInSize', { n: lowCount, size })
        : tf(lowCount === 1 ? 'stock.lowOne' : 'stock.low', { n: lowCount })

  // A colour that can still be bought, to offer when this one has sold out.
  // Not when the whole product is marked out of stock: then none can.
  const otherColor = p.statuses.includes('out_of_stock')
    ? undefined
    : p.colors.find((c) => c.name !== color && c.stock !== 0)

  // What this exact size + colour still allows: its stock minus what the cart
  // already holds. From the store, which also knows the server's latest
  // answer — the catalogue this page was rendered with can be minutes old.
  const { cart, stockLimit } = useStore()
  const lineColor = color ?? p.colors[0]?.name ?? '—'
  const limit = size ? stockLimit(p.id, size, lineColor) : null
  const inCart = size ? cart.find((c) => c.key === `${p.id}-${size}-${lineColor}`)?.qty ?? 0 : 0
  const remaining = limit === null ? null : Math.max(0, limit - inCart)
  /** The server says none are left, although the page's catalogue did not. */
  const unavailable = outOfStock || limit === 0
  /** Everything there is of this variant is already in the cart. */
  const maxedOut = !unavailable && remaining === 0 && inCart > 0

  // Never offer more than exists. 10 stays the ceiling, as before.
  const maxQty =
    remaining !== null
      ? Math.min(10, remaining)
      : selectedStock === undefined
        ? 10
        : Math.min(10, selectedStock)

  // The limit, said once the quantity reaches it — "Only 2 pcs. available in
  // size XL" — and never as a permanent counter on a well-stocked item.
  const limitNote =
    size && limit !== null && limit > 0 && remaining !== null && (maxedOut || qty >= remaining)
      ? namesSize
        ? tf('stock.onlyInSize', { n: limit, size })
        : tf('stock.only', { n: limit })
      : null

  // Scarcity, said when it is real: three or fewer of this exact size and
  // colour, read from live stock — so it never claims a shortage the database
  // does not have. Not once everything left is already in this cart.
  const hurryCount =
    size && limit !== null && limit > 0 && limit <= 3 && !maxedOut ? limit : null

  // The chosen variant is tracked and at zero: the waitlist form takes the
  // add-to-cart button's place.
  const showWaitlist = Boolean(tracked && size && color && (selectedStock === 0 || limit === 0))
  const soldOutSizes = tracked && color ? p.sizes.filter((s) => stockFor(s, color) === 0) : []

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
  // On the WRAPPER around the buy button, not the button: the button is swapped
  // for "notify when available" when the chosen variant is sold out, and a ref
  // on it would go null under the sticky bar's scroll handler. The wrapper is
  // always rendered and sits exactly where the button does.
  const buyButtonRef = useRef<HTMLDivElement>(null)
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

  /**
   * Share: the native share sheet where the browser has one, otherwise the
   * link on the clipboard. A dismissed sheet is the customer's answer, so it
   * falls back to nothing; a refused one falls back to copying.
   */
  // This product's own delivery window, in words, in the visitor's language.
  // The admin's store-wide timeframe ("10–14 business days") when it has none.
  const deliverySpan = describeProductDelivery(product, shipping.deliveryTimeframe, locale)

  async function share() {
    const url = window.location.href
    // The OS sheet on touch devices only — on a Windows desktop navigator.share
    // opens the system share panel, which nobody expects; copying is better.
    if (canShareNatively()) {
      const outcome = await shareNatively({ title: productName, url })
      if (outcome === 'shared' || outcome === 'dismissed') return
    }
    if (await copyText(url)) {
      pushToast({ title: t('looks.linkCopied'), variant: 'gold' })
    } else {
      pushToast({ title: t('share.copyManually'), description: url, variant: 'default' })
    }
  }

  function handleAdd() {
    if (!size || unavailable || maxedOut) return
    // The store adds only what the variant's stock allows, counting what is
    // already in the cart, and says how many went in — so a fast double tap,
    // or the main button and the sticky bar together, can never overshoot.
    const result = addToCart({
      productId: p.id,
      name: productName,
      image: selectedImage || p.image,
      price: p.price,
      size,
      color: lineColor,
      qty,
    })
    // The click confirms an item went in, so a press that added nothing
    // stays silent (the store's notice says why). Covers both buttons.
    if (result.added === 0) return
    playClickSound()
    setPanel('cart')
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
      {/* Gallery — full-bleed on a phone (the negative margin cancels the
          page's gutter), padded again from md up where the layout is two
          columns and an edge-to-edge photo would fight the text beside it. */}
      <div className="-mx-4 sm:-mx-6 md:mx-0">
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
                onClick={(e) => {
                  // The whole photo is the zoom button underneath: this click
                  // must change the photo and nothing else.
                  e.preventDefault()
                  e.stopPropagation()
                  goPrev()
                }}
                aria-label={t('product.prevImage')}
                className={cn(GALLERY_ARROW, 'left-3')}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  // The whole photo is the zoom button underneath: this click
                  // must change the photo and nothing else.
                  e.preventDefault()
                  e.stopPropagation()
                  goNext()
                }}
                aria-label={t('product.nextImage')}
                className={cn(GALLERY_ARROW, 'right-3')}
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

      {/* Details. Sticky from lg up, so the panel stays beside a long gallery
          as it scrolls. self-start is what lets it stick inside the grid; when
          the panel is taller than the gallery the row takes its height and
          it simply scrolls with the page, so nothing can end up hidden. The
          phone layout is a single column and never sticky. */}
      <div className="flex flex-col lg:sticky lg:top-24 lg:self-start">
        <p className="text-[10px] uppercase tracking-[0.25em] text-gold/70">
          {localize(categoryLabels[p.category] ?? {})}
        </p>
        {/* h1, not h2: on a dedicated page the product name is the document's
            heading, and a page whose only h1 is the site name ranks for the
            site name rather than the product. */}
        <h1 className="mt-3 font-serif text-3xl font-light leading-tight text-foreground sm:text-4xl">
          {productName}
        </h1>

        {/* The price, then — only for a real discount — the struck-through
            compare-at price and the percentage. No discount, nothing after the
            price: no empty gap, no badge. flex-wrap so a long converted figure
            never pushes the badge off a phone screen. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xl font-light text-foreground">{formatPrice(p.price)}</span>
          {discountPercent(p.price, p.oldPrice) > 0 && (
            <>
              <span className="text-base font-light text-muted-foreground/50 line-through">
                {formatPrice(p.oldPrice as number)}
              </span>
              <DiscountBadge price={p.price} oldPrice={p.oldPrice} className="px-2 py-1 text-[11px]" />
            </>
          )}
        </div>

        {/* The brand, when the admin set one — omitted rather than rendered
            as a label with nothing after it. The SKU moved to the foot of the
            panel, beside Share, as the article number. */}
        {p.brand && (
          <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60">
            {t('product.brand')}: <span className="text-foreground/80">{p.brand}</span>
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5">
          {outOfStock && (
            <span className="inline-flex items-center gap-1.5 border border-border/60 px-2.5 py-1 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {sizeSoldOut && sizeStatus ? sizeStatus : t('sold.out')}
            </span>
          )}
          {p.statuses
            // "In stock" beside a sold-out size or colour would contradict it.
            .filter((s) => s !== 'out_of_stock' && !(s === 'in_stock' && outOfStock))
            .map((s) => (
              <span key={s} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <ShieldCheck className="size-3 text-gold/60" />
                {/* "In stock", said of the chosen size once there is one. */}
                {s === 'in_stock' && sizeStatus ? sizeStatus : localize(STATUS_LABELS[s])}
              </span>
            ))}
        </div>

        {/* A warm light grey rather than the muted one: body copy someone reads
            before buying needs real contrast on this ground. An explicit value
            because the theme colours are hsl(var(--x)) with no alpha slot, so
            an opacity modifier like text-foreground/85 has no effect. pre-line
            keeps the paragraphs the admin typed. */}
        {/* Omitted when the product has no description yet, rather than
            leaving an empty gap in the panel. */}
        {localize(p.description).trim() && (
          <p className="mt-6 whitespace-pre-line text-[14px] font-light leading-[1.75] text-[#D9D4CA]">
            {localize(p.description)}
          </p>
        )}

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
                    'tap-safe no-juice relative flex size-9 items-center justify-center rounded-full border transition-all duration-200',
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-[11px] uppercase tracking-[0.15em] text-foreground">
              {t('product.size')}
            </p>
            <div className="flex items-center gap-4">
              {/* Renders nothing unless the run is letter sizes — a
                  height-and-weight table has nothing to say about 42 or OS.
                  "Available" means buyable in the colour chosen right now. */}
              <FitAdvisorModal
                sizes={p.sizes}
                // Buyable now: the catalogue's stock AND the server's latest
                // word on it (the store's stockLimit).
                isAvailable={(s) => stockFor(s, color) !== 0 && stockLimit(p.id, s, lineColor) !== 0}
                onApply={setSize}
                productCut={resolveTags(p).fit}
                sizeChart={p.sizeChart}
                productId={p.id}
                // Decides which measurements the finder asks for: a chest for
                // a jacket, a foot length for sneakers.
                group={p.group}
                category={p.category}
                // The printed chart lives on this page; the finder links to it.
                onOpenSizeChart={sizeChart.length > 0 ? () => setShowGuide(true) : undefined}
              />
              {/* Hidden entirely when the product has no measurements — an
                  empty guide is worse than no guide. */}
              {sizeChart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowGuide((v) => !v)}
                  className="tap-safe flex items-center gap-1 text-[11px] text-gold/70 transition hover:text-gold"
                >
                  <Ruler className="size-3" />
                  {t('product.sizeGuide')}
                </button>
              )}
            </div>
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
                  // No tick over a struck-through size: it cannot be chosen.
                  onMouseEnter={soldOut ? undefined : playHoverSound}
                  disabled={soldOut}
                  aria-label={soldOut ? `${s} — ${t('sold.out')}` : s}
                  title={soldOut ? `${s} — ${t('sold.out')}` : undefined}
                  className={cn(
                    'tap-safe min-w-11 border px-3 py-2.5 text-[13px] font-light transition-all duration-200',
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
          {lowStockText && hurryCount === null && <p className="mt-2 text-[11px] text-gold/80">{lowStockText}</p>}
          {/* Sold-out sizes cannot be selected, so the waitlist for them is a
              quiet link here — it opens the dialog on just those sizes. (A
              chosen variant at zero gets the inline form instead, below.) */}
          {soldOutSizes.length > 0 && color && !showWaitlist && (
            <NotifyWhenAvailable
              variant="compact"
              productId={p.id}
              color={color}
              sizes={soldOutSizes}
              className="mt-3"
            />
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

        {hurryCount !== null && (
          <p role="status" className="mt-7 flex items-center gap-2.5 text-[12px] font-medium tracking-wide text-orange-400">
            <HurryDot />
            {tf('stock.hurry', { n: hurryCount })}
          </p>
        )}

        <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', hurryCount !== null ? 'mt-4' : 'mt-8')}>
          <div className="flex items-center border border-border">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              className="no-juice flex size-11 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
              disabled={qty >= maxQty || maxedOut || unavailable}
              className="no-juice flex size-11 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('product.increase')}
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {limitNote && (
            <p className="text-[11px] font-light leading-snug text-gold/80" role="status">
              {limitNote}
              {inCart > 0 && (
                <span className="text-muted-foreground"> · {tf('stock.inCart', { n: inCart })}</span>
              )}
            </p>
          )}
        </div>

        <div ref={buyButtonRef} className="mt-4">
          {/* A tracked variant the customer has chosen, with none left: the
              add-to-cart button is REPLACED, not joined, by "notify when
              available" — a dead disabled button is the worst thing to show at
              the moment of disappointment. An untracked product marked sold
              out keeps the disabled state: there is no variant to subscribe to. */}
          {showWaitlist && size && color ? (
            <WaitlistForm productId={p.id} variantId={selectedVariant?.id} size={size} color={color} />
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              disabled={!size || unavailable || maxedOut}
              className="w-full border border-gold/30 bg-gold/5 py-4 text-[13px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
            >
              {unavailable
                ? t('sold.out')
                : maxedOut
                  ? t('stock.maxInCart')
                  : `${t('product.addToCart')} — ${formatPrice(p.price * qty)}`}
            </button>
          )}
        </div>

        {/* Unavailable — the whole product, or this colour. Never a dead end:
            another colour when one is in stock (shown beside "notify me", which
            only covers THIS colour), otherwise the rest of the collection. A
            single sold-out size needs neither: "notify me" is the answer and
            the other sizes are right there. */}
        {outOfStock &&
          ((colorSoldOut && otherColor) || !(tracked && size && color && selectedStock === 0)) && (
          <div className="mt-3 border border-border/60 px-4 py-3.5">
            <p className="text-[11px] uppercase tracking-[0.15em] text-foreground">
              {t('state.unavailableTitle')}
            </p>
            <p className="mt-1 text-[12px] font-light leading-relaxed text-muted-foreground">
              {otherColor ? t('state.unavailableColorHint') : t('state.unavailableHint')}
            </p>
            {otherColor ? (
              <button
                type="button"
                onClick={() => {
                  setColor(otherColor.name)
                  setSelectedIndex(0)
                }}
                className="tap-safe mt-2 text-[11px] uppercase tracking-[0.15em] text-gold transition hover:text-gold/80"
              >
                {t('state.chooseColor')}
              </button>
            ) : (
              <Link
                href={`/category/${encodeURIComponent(p.group)}`}
                className="tap-safe mt-2 inline-block text-[11px] uppercase tracking-[0.15em] text-gold transition hover:text-gold/80"
              >
                {t('state.viewSimilar')}
              </Link>
            )}
          </div>
        )}

        {/* Delivery, timing, returns — each opens to the shop's own wording.
            Every figure is read from data, never typed in: the fee and the
            free-shipping threshold from the admin's settings, this product's delivery
            window from its own estimate (the store default when the admin set
            none), the return period from the returns policy. */}
        <Accordion type="single" collapsible className="mt-7 border-t border-border/40">
          <AccordionItem value="shipping" className="border-border/40">
            <AccordionTrigger className="py-3.5 text-left text-[12px] font-light tracking-wide text-foreground/85 hover:text-foreground hover:no-underline">
              <span className="flex items-center gap-3">
                <Package className="size-4 shrink-0 text-gold/70" strokeWidth={1.5} />
                {tf('product.freeShippingFrom', { amount: formatPrice(shipping.freeShippingThreshold) })}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-4 pl-7 text-[12px] font-light leading-relaxed text-muted-foreground">
              {tf('product.shippingDetails', {
                // To the cent: a fee is quoted exactly (CHF 14.90, not CHF 15).
                price: formatPrice(shipping.shippingPrice, true),
                amount: formatPrice(shipping.freeShippingThreshold),
              })}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="delivery" className="border-border/40">
            <AccordionTrigger className="py-3.5 text-left text-[12px] font-light tracking-wide text-foreground/85 hover:text-foreground hover:no-underline">
              <span className="flex items-center gap-3">
                <CalendarDays className="size-4 shrink-0 text-gold/70" strokeWidth={1.5} />
                {tf('product.deliveryEstimate', { span: deliverySpan })}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-4 pl-7 text-[12px] font-light leading-relaxed text-muted-foreground">
              {tf('product.deliveryDetails', { span: deliverySpan })}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="returns" className="border-border/40">
            <AccordionTrigger className="py-3.5 text-left text-[12px] font-light tracking-wide text-foreground/85 hover:text-foreground hover:no-underline">
              <span className="flex items-center gap-3">
                <RotateCcw className="size-4 shrink-0 text-gold/70" strokeWidth={1.5} />
                {tf('product.returnsWithin', { n: RETURN_DAYS })}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-4 pl-7 text-[12px] font-light leading-relaxed text-muted-foreground">
              {t('help.returns.content')}{' '}
              <Link href="/legal/refunds" className="text-gold/80 underline-offset-4 hover:text-gold hover:underline">
                {t('product.returnsPolicy')} →
              </Link>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Trust, in one quiet line — no payment logos. */}
        <div className="mt-5 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gold/70" strokeWidth={1.5} />
          <div>
            <p className="text-[11px] uppercase tracking-[0.15em] text-foreground/85">
              {t('product.securePurchase')}
            </p>
            <p className="mt-0.5 text-[12px] font-light text-muted-foreground">
              {t('product.securePurchaseBody')}
            </p>
          </div>
        </div>

        {/* The article number of the exact variant chosen (a support query
            quoting it is far easier to answer), and Share. */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/40 pt-4">
          {sku ? (
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60">
              {t('product.article')}:{' '}
              <span className="font-mono normal-case tracking-normal text-foreground/80">{sku}</span>
            </p>
          ) : (
            <span aria-hidden />
          )}
          <button
            type="button"
            onClick={() => void share()}
            className="tap-safe inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70 transition-colors duration-300 hover:text-gold"
          >
            <Share2 className="size-3.5" strokeWidth={1.5} />
            {t('product.share')}
          </button>
        </div>
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
          'hide-with-keyboard fixed inset-x-0 bottom-0 z-40 border-t border-border bg-popover/95 px-4 py-3 backdrop-blur-md transition-transform duration-300 sm:hidden',
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
            disabled={!size || unavailable || maxedOut}
            tabIndex={showStickyBuy ? 0 : -1}
            className="max-w-[55%] shrink-0 border border-gold/40 bg-gold/10 px-6 py-3 text-[12px] uppercase tracking-[0.12em] text-gold transition-all duration-300 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
          >
            {unavailable
              ? t('sold.out')
              : !size
                ? t('product.selectSize')
                : maxedOut
                  ? t('stock.maxInCart')
                  : t('product.addToCart')}
          </button>
        </div>
      </div>
    </div>
  )
}
