'use client'

import { ArrowRight } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link } from '@/components/locale-link'
import { discountPercent } from '@/components/products/discount-badge'
import { isProductBuyable } from '@/lib/availability'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'
import { useListing } from './listing-context'
import { ProductCard } from './product-card'

/** How many products a rail shows. */
const RAIL_SIZE = 8

/**
 * Below this many products a department's grid already shows everything on
 * its first screen (ProductGrid pages by 12), and a rail above it would only
 * repeat the same cards.
 */
const MIN_PRODUCTS = 13

type Rail = { key: 'best' | 'new' | 'sale'; label: string; products: Product[]; href: string | null }

/**
 * "Best sellers", "New in" and "On sale" for one department — the featured
 * collections a department page can honestly back with data, and nothing
 * else.
 *
 *  - BEST SELLERS are ranked by units sold in paid orders over the last six
 *    months (lib/server/popular-products.ts — the homepage's own ranking),
 *    and the rail exists only when at least three of the department's
 *    products have sold. The page receives the ranked ids, never the figures.
 *  - NEW IN is the department's most recently added products, ordered by
 *    the date each was created (products.created_at). Not a hand-picked list
 *    called "new".
 *  - ON SALE is what carries a real reduction: `oldPrice` comes only from the
 *    prices the shop actually charged (lib/price-reference.ts), and
 *    discountPercent ignores a compare-at price at or below the price.
 *
 * There is no "Trending": the storefront records no views or other
 * popularity signal to rank by, and the label over an arbitrary list would
 * be a claim the shop cannot support.
 *
 * Only what can be bought now goes on a rail, and the section renders nothing
 * when neither rail has anything to show or the department is small enough
 * for its grid to show it all at once. Each rail ends in a link that opens the
 * same selection in the grid below (?sort=newest, ?sale=1).
 */
export function DepartmentFeatured({ group }: { group: string }) {
  const { t } = useStore()
  const listing = useListing()
  const tabsId = useId()

  const rails = useMemo<Rail[]>(() => {
    const inDepartment = (listing?.products ?? []).filter((p) => p.group === group)
    if (inDepartment.length < MIN_PRODUCTS) return []
    const buyable = inDepartment.filter(isProductBuyable)

    const newest = buyable
      .filter((p) => typeof p.createdAt === 'number' && p.createdAt > 0)
      .sort((a, b) => (b.createdAt as number) - (a.createdAt as number))
      .slice(0, RAIL_SIZE)
    const onSale = buyable
      .filter((p) => discountPercent(p.price, p.oldPrice) > 0)
      .sort((a, b) => discountPercent(b.price, b.oldPrice) - discountPercent(a.price, a.oldPrice))
      .slice(0, RAIL_SIZE)

    const byId = new Map(buyable.map((p) => [p.id, p]))
    const best = (listing?.bestsellers ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is Product => Boolean(p))
      .slice(0, RAIL_SIZE)

    const out: Rail[] = []
    if (best.length >= 3) {
      // No "view all": the grid has no sales order to open.
      out.push({ key: 'best', label: t('dept.bestsellers'), products: best, href: null })
    }
    // Two or more, or it is not a selection.
    if (newest.length >= 2) {
      out.push({ key: 'new', label: t('dept.newIn'), products: newest, href: `/category/${group}?sort=newest#listing` })
    }
    if (onSale.length >= 1) {
      out.push({ key: 'sale', label: t('dept.onSale'), products: onSale, href: `/category/${group}?sale=1#listing` })
    }
    return out
  }, [listing, group, t])

  const [active, setActive] = useState<Rail['key'] | null>(null)
  if (rails.length === 0) return null
  const current = rails.find((r) => r.key === active) ?? rails[0]

  return (
    <section aria-label={t('dept.featured')} className="mb-12 lg:mb-14">
      <div className="mb-5 flex items-end justify-between gap-4 border-b border-border/50">
        <div role="tablist" aria-label={t('dept.featured')} className="flex gap-6">
          {rails.map((rail) => {
            const selected = rail.key === current.key
            return (
              <button
                key={rail.key}
                type="button"
                role="tab"
                id={`${tabsId}-${rail.key}-tab`}
                aria-selected={selected}
                aria-controls={`${tabsId}-${rail.key}-panel`}
                onClick={() => setActive(rail.key)}
                className={cn(
                  'tap-safe relative -mb-px border-b pb-3 font-serif text-[18px] tracking-tight transition-colors sm:text-[20px]',
                  selected
                    ? 'border-gold text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {rail.label}
              </button>
            )
          })}
        </div>
        {current.href && (
          <Link
            href={current.href}
            className="tap-safe mb-3 flex shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-gold"
          >
            {t('dept.viewAll')}
            <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        )}
      </div>

      <div
        role="tabpanel"
        id={`${tabsId}-${current.key}-panel`}
        aria-labelledby={`${tabsId}-${current.key}-tab`}
        className="-mx-4 sm:-mx-6 lg:mx-0"
      >
        <ul
          className={cn(
            'flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:gap-5 sm:px-6 lg:px-0',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {current.products.map((product) => (
            <li
              key={product.id}
              className="w-[44%] shrink-0 snap-start sm:w-[30%] lg:w-[calc((100%-3*1.25rem)/4)]"
            >
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
