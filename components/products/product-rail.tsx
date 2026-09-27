'use client'

import { useEffect, useState } from 'react'
import { ProductCard } from '@/components/products/product-card'
import { useProductsById, useStore } from '@/lib/store'
import type { Product } from '@/lib/types'

/**
 * Related products and recently viewed.
 *
 * Both are horizontal rails of the SAME card the grid uses. Reusing
 * ProductCard rather than writing a compact variant means the hover
 * cross-fade, the brand line, the sold-out treatment and the discount chip
 * all behave identically wherever a product appears — three card components
 * is how those quietly drift apart.
 *
 * The related rail is chosen on the server (relatedProducts() in
 * lib/server/catalog-listing.ts) and arrives with the page. Recently viewed
 * is this browser's own history, so it is looked up by id after mount — a
 * few products from the edge cache, not the whole catalogue.
 */

const RECENT_KEY = 'lv.recently-viewed.v1'
const MAX_RECENT = 8

/**
 * Records a product view.
 *
 * Local only. A browsing history is a record of what someone looked at and did
 * not buy; there is no reason for it to reach a server that has no use for it.
 * The analytics `view_item` event is separate and consent-gated.
 */
export function rememberViewed(productId: string): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
    // Most recent first, de-duplicated: viewing something again should move it
    // up rather than appear twice.
    const next = [productId, ...ids.filter((id) => id !== productId)].slice(0, MAX_RECENT)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked. The rail simply stays empty.
  }
}

function readViewed(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function Rail({ title, products }: { title: string; products: Product[] }) {
  if (products.length === 0) return null

  return (
    <section className="mt-16 border-t border-border/50 pt-10">
      <h2 className="mb-6 font-serif text-2xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      {/* A scrolling row rather than a wrapping grid: these are a suggestion,
          not the catalogue, and letting them reflow into three tall rows would
          push the reviews below off the page. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {products.map((p) => (
          <div key={p.id} className="w-[46%] shrink-0 snap-start sm:w-[30%] lg:w-[22%]">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  )
}

export function RelatedProducts({ products }: { products: Product[] }) {
  const { t } = useStore()
  return <Rail title={t('product.related')} products={products} />
}

export function RecentlyViewed({ currentId }: { currentId: string }) {
  const { t } = useStore()
  const [ids, setIds] = useState<string[]>([])

  // Read after mount, not during render: localStorage does not exist on the
  // server and reading it in render would make the markup differ between the
  // two passes.
  useEffect(() => {
    setIds(readViewed().filter((id) => id !== currentId))
  }, [currentId])

  // Withdrawn products simply drop out; the rail hides itself when empty.
  const { products } = useProductsById(ids)

  return <Rail title={t('product.recentlyViewed')} products={products} />
}
