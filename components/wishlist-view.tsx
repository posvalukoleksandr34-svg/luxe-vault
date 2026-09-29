'use client'

import { Heart } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { ProductCard } from '@/components/products/product-card'
import { useProductsById, useStore } from '@/lib/store'

/**
 * The saved-products screen behind the bottom bar's "Избранное".
 *
 * The list is ids — this browser's while signed out (lib/wishlist.ts), the
 * account's once signed in (app/actions/wishlist.ts), folded together at
 * sign-in so nothing saved before the account existed is lost. The products
 * themselves come from the catalogue the store already holds, so every card
 * shows today's price and availability. An id whose product has since been
 * withdrawn simply does not render — and the count of those is disclosed rather than silently
 * swallowed, so a list that looks shorter than expected explains itself.
 *
 * Deliberately available to guests: saving something is how a first-time
 * visitor keeps track, and demanding an account first is what loses them.
 */
export function WishlistView() {
  const { wishlist, wishlistCount, wishlistStatus, reloadWishlist, t, tf } = useStore()

  // The saved products, looked up by id — a few products, not the catalogue.
  // Resolving them is also what settles the header badge (wishlistCount).
  const { products: saved, pending, missing } = useProductsById(wishlist)
  // "Empty" only when it is known to be: never while a signed-in customer's
  // list is still on its way, nor while saved ids are being looked up.
  const loading = wishlistStatus === 'loading' || (pending && wishlist.length > 0)


  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t('wishlist.title')}
        </h1>
        {wishlistCount > 0 && (
          <p className="mt-2 text-[12px] uppercase tracking-[0.2em] text-muted-foreground">
            {/* The same count the header's badge shows — resolvable products,
                not saved ids. The two disagreeing is what made a "2 SAVED"
                heading sit above an empty grid. */}
            {tf('wishlist.count', { n: wishlistCount })}
          </p>
        )}
      </header>

      {saved.length === 0 && loading ? (
        <div className="flex justify-center py-24" role="status" aria-live="polite">
          <Heart aria-hidden strokeWidth={1.25} className="size-9 animate-pulse text-gold" />
          <span className="sr-only">{t('wishlist.title')}</span>
        </div>
      ) : saved.length === 0 && wishlistStatus === 'error' ? (
        <div className="flex flex-col items-center py-16 text-center" role="alert">
          <Heart aria-hidden strokeWidth={1.25} className="size-9 text-gold" />
          <p className="mt-6 max-w-sm text-[14px] font-light leading-relaxed text-foreground">
            {t('wishlist.loadFailed')}
          </p>
          <button
            type="button"
            onClick={reloadWishlist}
            className="mt-8 inline-flex items-center justify-center rounded-xl border border-gold px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : saved.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Heart aria-hidden strokeWidth={1.25} className="size-9 text-gold" />
          <p className="mt-6 font-serif text-xl text-foreground">{t('wishlist.empty')}</p>
          <p className="mt-3 max-w-sm text-[13px] font-light leading-relaxed text-muted-foreground">
            {t('wishlist.emptyHint')}
          </p>
          <Link
            href="/catalog"
            className="mt-8 inline-flex items-center justify-center rounded-xl border border-gold px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('wishlist.browse')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 md:gap-x-4 xl:grid-cols-4">
            {saved.map((product, i) => (
              <ProductCard key={product.id} product={product} priority={i < 2} />
            ))}
          </div>
          {missing > 0 && (
            <p className="mt-10 text-[12px] font-light text-muted-foreground/90">{t('wishlist.gone')}</p>
          )}
        </>
      )}
    </section>
  )
}
