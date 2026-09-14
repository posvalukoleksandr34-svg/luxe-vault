'use client'

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
      <main id="main" className="flex min-h-[100svh] items-center justify-center bg-[#000000] px-6">
        <p role="status" className="flex items-center gap-3 text-[12px] uppercase tracking-[0.18em] text-[#CCCCCC]">
          <Loader2 aria-hidden className="size-4 animate-spin text-[#D4AF37]" />
          {t('cartRestore.restoring')}
        </p>
      </main>
    )
  }

  const title = state === 'ordered' ? t('cartRestore.orderedTitle') : t('cartRestore.goneTitle')
  const hint = state === 'ordered' ? t('cartRestore.orderedHint') : t('cartRestore.goneHint')
  return (
    <main id="main" className="flex min-h-[100svh] items-center justify-center bg-[#000000] px-6 py-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <ShoppingBag aria-hidden strokeWidth={1.25} className="size-9 text-[#D4AF37]" />
        <span aria-hidden className="mt-6 h-px w-12 bg-[#D4AF37]" />
        <h1 className="mt-6 font-serif text-2xl tracking-wide text-[#E5E5E5]">{title}</h1>
        <p className="mt-4 text-sm font-light leading-relaxed text-[#CCCCCC]">{hint}</p>
        <a
          href="/"
          className="tap-safe mt-10 border border-[#D4AF37] px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-[#D4AF37] transition-colors hover:bg-[#D4AF37] hover:text-[#000000]"
        >
          {t('state.goToCatalog')}
        </a>
      </div>
    </main>
  )
}
