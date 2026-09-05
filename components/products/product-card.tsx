'use client'

import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

export function ProductCard({ product }: { product: Product }) {
  const { openProduct, localize, t, categoryLabels } = useStore()
  const outOfStock = product.statuses.includes('out_of_stock')
  const discount = product.oldPrice
    ? Math.round((1 - product.price / product.oldPrice) * 100)
    : 0
  // A second image (when present) is cross-faded in on hover to suggest a
  // change of angle, rather than a plain zoom — the "dressed for the camera"
  // hover moment editorial lookbooks use.
  const secondaryImage = product.images?.[1]

  return (
    <div className="group cursor-pointer" onClick={() => openProduct(product)}>
      <div className="relative aspect-[3/4] overflow-hidden border border-transparent bg-card transition-colors duration-500 group-hover:border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image}
          alt={localize(product.name)}
          className={cn(
            'size-full object-cover transition-[transform,opacity] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.045]',
            outOfStock && 'opacity-40 grayscale',
            secondaryImage && 'group-hover:opacity-0',
          )}
        />

        {secondaryImage && (
          <img
            src={secondaryImage}
            alt=""
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
          {discount > 0 && (
            <span className="text-[10px] uppercase tracking-[0.15em] text-destructive">
              −{discount}%
            </span>
          )}
        </div>

        {product.limited && !outOfStock && (
          <span className="absolute bottom-3 left-3 text-[10px] uppercase tracking-[0.15em] text-gold/90">
            Limited
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
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
          {localize(categoryLabels[product.category] ?? {})}
        </p>
        <h3 className="font-serif text-[15px] font-medium leading-snug text-foreground transition-colors duration-300 group-hover:text-gold/90">
          {localize(product.name)}
        </h3>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[13px] font-light text-foreground">
            {formatPrice(product.price)}
          </span>
          {product.oldPrice && (
            <span className="text-[11px] font-light text-muted-foreground/50 line-through">
              {formatPrice(product.oldPrice)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
