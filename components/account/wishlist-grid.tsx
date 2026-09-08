'use client'

import { Heart, Loader2, ShoppingBag, Trash2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { ProductCard } from '@/components/products/product-card'
import { formatPrice, useStore } from '@/lib/store'

/**
 * The customer's saved products.
 *
 * Two layouts from one source of truth, because the drawer and the account
 * page have very different room:
 *
 *   compact  a list of rows, for the 448px drawer. A product grid at that
 *            width is one column of enormous cards.
 *   full     the same ProductCard the shop uses, so a saved product looks
 *            identical wherever it appears.
 *
 * Resolved against the live catalogue rather than storing a snapshot, so a
 * product that was withdrawn disappears instead of rendering as a broken card
 * at a price that no longer exists.
 */
export function WishlistGrid({ compact = false }: { compact?: boolean }) {
  const { wishlist, products, catalogLoading, toggleWishlist, addToCart, setPanel, t, localize } =
    useStore()

  const saved = wishlist
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))

  // The catalogue arrives with the page, but a hard refresh inside the drawer
  // can render this before it lands — showing "empty" then filling in reads as
  // a bug rather than as loading.
  if (catalogLoading && wishlist.length > 0 && saved.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-4 animate-spin text-gold" />
      </div>
    )
  }

  if (saved.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Heart className="size-6 text-muted-foreground/25" strokeWidth={1.25} />
        <p className="text-[13px] font-light text-muted-foreground">{t('wishlist.empty')}</p>
        <Link
          href="/#shop"
          onClick={() => compact && setPanel(null)}
          className="border border-gold/40 bg-gold/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
        >
          {t('cart.continueShopping')}
        </Link>
      </div>
    )
  }

  if (!compact) {
    return (
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3">
        {saved.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {saved.map((product) => {
        const soldOut = product.statuses.includes('out_of_stock')
        return (
          <li key={product.id} className="flex gap-3 border-b border-border/40 pb-3 last:border-b-0">
            <Link
              href={`/product/${encodeURIComponent(product.id)}`}
              onClick={() => setPanel(null)}
              className="relative size-16 shrink-0 overflow-hidden border border-border/60"
            >
              <Image
                src={product.image}
                alt={localize(product.name)}
                fill
                sizes="64px"
                className="object-cover"
              />
            </Link>

            <div className="flex min-w-0 flex-1 flex-col">
              <Link
                href={`/product/${encodeURIComponent(product.id)}`}
                onClick={() => setPanel(null)}
                className="truncate text-[13px] font-light text-foreground transition hover:text-gold"
              >
                {localize(product.name)}
              </Link>
              <span className="mt-0.5 text-[12px] text-muted-foreground">
                {formatPrice(product.price)}
              </span>

              <div className="mt-auto flex items-center gap-2 pt-2">
                {/* Straight to the product page, not straight to the cart: a
                    saved item still needs a size and a colour chosen, and a
                    "move to cart" button that silently picks them for the
                    customer is how the wrong size gets ordered. */}
                <Link
                  href={`/product/${encodeURIComponent(product.id)}`}
                  onClick={() => setPanel(null)}
                  aria-disabled={soldOut}
                  className={
                    soldOut
                      ? 'pointer-events-none flex items-center gap-1.5 border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40'
                      : 'flex items-center gap-1.5 border border-gold/40 bg-gold/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-gold transition hover:bg-gold hover:text-gold-foreground'
                  }
                >
                  <ShoppingBag className="size-3" />
                  {soldOut ? t('sold.out') : t('product.addToCart')}
                </Link>

                <button
                  type="button"
                  onClick={() => void toggleWishlist(product.id)}
                  aria-label={t('wishlist.remove')}
                  title={t('wishlist.remove')}
                  className="flex size-7 items-center justify-center text-muted-foreground/60 transition hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
