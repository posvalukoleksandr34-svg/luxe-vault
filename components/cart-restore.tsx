'use client'

import { Link } from '@/components/locale-link'
import { Loader2, ShoppingBag } from 'lucide-react'
import { useEffect } from 'react'
import { readCart, writeCart } from '@/lib/cart-storage'
import { useStore } from '@/lib/store'
import type { CartItem } from '@/lib/types'

/**
 * Where a reminder's "Return to your Vault" link lands.
 *
 * Puts the saved lines back into this browser's cart — merged with anything
 * already in it, never replacing it — and goes straight to checkout. A full
 * navigation, so the store starts from the restored cart; it then re-prices
 * every line against the live catalogue (reconcileCart) as it does for any
 * saved cart, and the server re-prices again at order time.
 */
export function CartRestore({
  state,
  items,
}: {
  state: 'restore' | 'ordered' | 'missing'
  items: CartItem[]
}) {
  const { t } = useStore()

  useEffect(() => {
    if (state !== 'restore') return
    const current = readCart()
    const keys = new Set(current.map((i) => i.key))
    writeCart(current.concat(items.filter((i) => !keys.has(i.key))))
    window.location.replace('/checkout')
  }, [state, items])

  if (state === 'restore') {
    return (
      <main id="main" className="flex min-h-[100svh] items-center justify-center bg-background px-6">
        <p role="status" className="flex items-center gap-3 text-[12px] uppercase tracking-[0.18em] text-foreground/80">
          <Loader2 aria-hidden className="size-4 animate-spin text-gold" />
          {t('cartRestore.restoring')}
        </p>
      </main>
    )
  }

  const title = state === 'ordered' ? t('cartRestore.orderedTitle') : t('cartRestore.goneTitle')
  const hint = state === 'ordered' ? t('cartRestore.orderedHint') : t('cartRestore.goneHint')
  return (
    <main id="main" className="flex min-h-[100svh] items-center justify-center bg-background px-6 py-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <ShoppingBag aria-hidden strokeWidth={1.25} className="size-9 text-gold" />
        <span aria-hidden className="mt-6 h-px w-12 bg-gold" />
        <h1 className="mt-6 font-serif text-2xl tracking-wide text-foreground">{title}</h1>
        <p className="mt-4 text-sm font-light leading-relaxed text-foreground/80">{hint}</p>
        <Link
          href="/"
          className="tap-safe mt-10 rounded-xl border border-gold px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors hover:bg-gold hover:text-gold-foreground"
        >
          {t('state.goToCatalog')}
        </Link>
      </div>
    </main>
  )
}
