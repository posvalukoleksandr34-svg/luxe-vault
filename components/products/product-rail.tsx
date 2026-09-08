'use client'

import { useEffect, useState } from 'react'
import { ProductCard } from '@/components/products/product-card'
import { useStore } from '@/lib/store'
import type { Product } from '@/lib/types'

/**
 * Related products and recently viewed.
 *
 * Both are horizontal rails of the SAME card the grid uses. Reusing
 * ProductCard rather than writing a compact variant means the hover
 * cross-fade, the replica badge, the sold-out treatment and the discount
 * chip all behave identically wherever a product appears — three card
 * components is how those quietly drift apart.
 *
 * Rendered client-side from the catalogue already in the store, so neither
 * rail costs a request.
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

export function RelatedProducts({ product }: { product: Product }) {
  const { products, t } = useStore()

  // Same category first, then the rest of the collection. Falling back to the
  // collection matters on a thin catalogue, where a category may hold only the
  // product being viewed and the rail would otherwise be empty.
  const sameCategory = products.filter(
    (p) => p.id !== product.id && p.category === product.category,
  )
  const sameGroup = products.filter(
    (p) => p.id !== product.id && p.group === product.group && p.category !== product.category,
  )

  const related = [...sameCategory, ...sameGroup].slice(0, 8)

  return <Rail title={t('product.related')} products={related} />
}

export function RecentlyViewed({ currentId }: { currentId: string }) {
  const { products, t } = useStore()
  const [ids, setIds] = useState<string[]>([])

  // Read after mount, not during render: localStorage does not exist on the
  // server and reading it in render would make the markup differ between the
  // two passes.
  useEffect(() => {
    setIds(readViewed())
  }, [currentId])

  const items = ids
    .filter((id) => id !== currentId)
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p))

  return <Rail title={t('product.recentlyViewed')} products={items} />
}
