'use client'

import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useStore } from '@/lib/store'
import type { Product } from '@/lib/types'

/**
 * "Style this piece" — the stylist opens with this product pinned into its
 * slot and builds the rest of the look around it. A quiet row rather than a
 * banner: someone on a product page is already close to buying, and this is
 * an aid, not an interruption.
 *
 * Moved out of the server-rendered page so the words follow the visitor's
 * language: the button was hardcoded English, and the line beside it always
 * the default locale.
 */
export function StyleThisPiece({ product }: { product: Product }) {
  const { t, localize, categoryLabels } = useStore()
  const category = localize(categoryLabels[product.category] ?? {}) || product.category

  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-y border-border/40 py-5">
      <p className="text-[12px] font-light text-muted-foreground">
        {localize(product.name)} — {category}
      </p>
      <Link
        href={`/stylist?product=${encodeURIComponent(product.id)}`}
        className="tap-safe inline-flex items-center gap-2 border border-gold/30 bg-gold/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
      >
        <Sparkles className="size-3.5" />
        {t('stylist.stylePiece')}
      </Link>
    </div>
  )
}
