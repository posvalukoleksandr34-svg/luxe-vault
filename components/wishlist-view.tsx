'use client'

import { Heart } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { ProductCard } from '@/components/products/product-card'
import { useStore } from '@/lib/store'

/**
 * The saved-products screen behind the bottom bar's "Избранное".
 *
 * The list is ids in this browser (lib/wishlist.ts); the products themselves
 * come from the catalogue the store already holds, so every card shows today's
 * price and availability. An id whose product has since been withdrawn simply
 * does not render — and the count of those is disclosed rather than silently
 * swallowed, so a list that looks shorter than expected explains itself.
 *
 * Deliberately available to guests: saving something is how a first-time
 * visitor keeps track, and demanding an account first is what loses them.
 */
export function WishlistView() {
  const { wishlist, products, t, tf, catalogLoading } = useStore()

  const saved = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]))
    return wishlist.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
  }, [wishlist, products])

  const missing = wishlist.length - saved.length

  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t('wishlist.title')}
        </h1>
        {wishlist.length > 0 && (
          <p className="mt-2 text-[12px] uppercase tracking-[0.2em] text-muted-foreground">
            {tf('wishlist.count', { n: wishlist.length })}
          </p>
        )}
      </header>

      {saved.length === 0 ? (
        // `catalogLoading` matters here: with an empty catalogue every saved id
        // looks withdrawn, and claiming the list is empty would be wrong.
        <div className="flex flex-col items-center py-16 text-center">
          <Heart aria-hidden strokeWidth={1.25} className="size-9 text-gold/70" />
          <p className="mt-6 font-serif text-xl text-foreground">
            {catalogLoading && wishlist.length > 0 ? '…' : t('wishlist.empty')}
          </p>
          <p className="mt-3 max-w-sm text-[13px] font-light leading-relaxed text-muted-foreground">
            {t('wishlist.emptyHint')}
          </p>
          <Link
            href="/#shop"
            className="mt-8 inline-flex items-center justify-center border border-gold px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('wishlist.browse')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
            {saved.map((product, i) => (
              <ProductCard key={product.id} product={product} priority={i < 2} />
            ))}
          </div>
          {missing > 0 && (
            <p className="mt-10 text-[12px] font-light text-muted-foreground/80">{t('wishlist.gone')}</p>
          )}
        </>
      )}
    </section>
  )
}
