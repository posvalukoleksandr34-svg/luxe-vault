'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { DiscountBadge, discountPercent } from '@/components/products/discount-badge'
import { HurryDot } from '@/components/products/hurry-dot'
import { useAudioFeedback } from '@/hooks/use-audio-feedback'
import { PRODUCT_PLACEHOLDER, productImage } from '@/lib/product-image'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

export function ProductCard({
  product,
  priority = false,
}: {
  product: Product
  /** Above the fold (the first row of a category page): fetch the photo
   *  eagerly and at high priority — it is the page's LCP candidate. */
  priority?: boolean
}) {
  const { localize, t, tf, categoryLabels } = useStore()
  const { playHoverSound } = useAudioFeedback()
  // Units across every size and colour — null when stock is not tracked
  // (no variant rows), which is NOT the same as none left.
  const totalStock =
    product.variants && product.variants.length > 0
      ? product.variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0)
      : null
  const outOfStock = product.statuses.includes('out_of_stock') || totalStock === 0
  // Scarcity only when real: three or fewer left in all.
  const hurryCount = !outOfStock && totalStock !== null && totalStock <= 3 ? totalStock : null
  // Only a real discount — a compare-at price above the price. See
  // discountPercent: an old price at or below the price shows nothing.
  const discount = discountPercent(product.price, product.oldPrice)
  // A second image (when present) is cross-faded in on hover to suggest a
  // change of angle, rather than a plain zoom — the "dressed for the camera"
  // hover moment editorial lookbooks use.
  const secondaryImage = product.images?.[1]
  // A missing or broken photo shows the placeholder, never an error or a
  // broken-image icon in the grid.
  const [imageFailed, setImageFailed] = useState(false)

  return (
    // A real <a href>, not an onClick. A div with a click handler is invisible
    // to crawlers, cannot be opened in a new tab, middle-clicked, copied as a
    // link, or reached by keyboard — all of which a product page exists to
    // support. next/link also prefetches the route on hover.
    <Link
      href={`/product/${encodeURIComponent(product.id)}`}
      onMouseEnter={playHoverSound}
      className="group block"
    >
      <div className="card-gold product-card relative aspect-[3/4] overflow-hidden">
        <Image
          src={imageFailed ? PRODUCT_PLACEHOLDER : productImage(product.image)}
          onError={() => setImageFailed(true)}
          alt={localize(product.name)}
          fill
          priority={priority}
          // The grid's own breakpoints: 2 columns below md (768px), 3 below
          // xl (1280px), then 4 in a 1400px container (~320px a card).
          sizes="(max-width: 767px) 50vw, (max-width: 1279px) 33vw, 320px"
          className={cn(
            'size-full object-cover transition-[transform,opacity] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.045]',
            outOfStock && 'opacity-40 grayscale',
            secondaryImage && 'group-hover:opacity-0',
          )}
        />

        {secondaryImage && (
          <Image
            src={secondaryImage}
            alt=""
            fill
            sizes="(max-width: 767px) 50vw, (max-width: 1279px) 33vw, 320px"
            aria-hidden
            className={cn(
              'absolute inset-0 size-full scale-[1.045] object-cover opacity-0 transition-opacity duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100',
              outOfStock && 'grayscale',
            )}
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          {outOfStock && (
            <span className="bg-background/90 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t('sold.out')}
            </span>
          )}
          {!outOfStock && product.isNew && (
            <span className="text-[10px] uppercase tracking-[0.15em] text-foreground">
              {t('filter.new')}
            </span>
          )}
        </div>

        {/* The discount, in the top-right corner — gold on the dark ground,
            never red: here red means an error, and a discount is not one. */}
        <DiscountBadge
          price={product.price}
          oldPrice={product.oldPrice}
          className="absolute right-3 top-3"
        />

        {product.limited && !outOfStock && (
          <span className="absolute bottom-3 left-3 text-[10px] uppercase tracking-[0.15em] text-gold/90">
            {t('card.limited')}
          </span>
        )}

        {!outOfStock && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center pb-4 opacity-0 transition-all duration-500 group-hover:opacity-100">
            <span className="border border-gold/40 bg-background/85 px-5 py-2 text-[11px] uppercase tracking-[0.2em] text-gold backdrop-blur-md">
              {t('product.addToCart')}
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-0.5">
        {/* Brand above the name when the product has one, category when it
            does not. One line either way, so a catalogue where only some
            products are branded does not render as a ragged grid — and no
            empty row where a brand would have been. */}
        {product.brand ? (
          <p className="text-[10px] uppercase tracking-[0.2em] text-gold/80">{product.brand}</p>
        ) : (
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
            {localize(categoryLabels[product.category] ?? {})}
          </p>
        )}
        <h3 className="font-serif text-[15px] font-medium leading-snug text-foreground transition-colors duration-500 group-hover:text-gold/90">
          <span className="product-card-name">{localize(product.name)}</span>
        </h3>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[13px] font-light text-foreground">
            {formatPrice(product.price)}
          </span>
          {discount > 0 && (
            <span className="text-[11px] font-light text-muted-foreground/50 line-through">
              {formatPrice(product.oldPrice as number)}
            </span>
          )}
        </div>
        {hurryCount !== null && (
          <p className="mt-1 flex items-center gap-2 text-[11px] font-medium text-orange-400">
            <HurryDot />
            {tf('stock.hurry', { n: hurryCount })}
          </p>
        )}
      </div>
    </Link>
  )
}
