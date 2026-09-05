'use client'

import { SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Reveal } from '@/components/reveal'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { ProductCard } from './product-card'

const STANDARD_SIZES = ['S', 'M', 'L', 'XL']

export function ProductGrid() {
  const { products, filter, setFilter, query, t, localize, categoryTree, groupLabels, categoryLabels } =
    useStore()
  const [filtersOpen, setFiltersOpen] = useState(false)

  const filtered = useMemo(() => {
    const result = products.filter((p) => {
      if (filter.group && p.group !== filter.group) return false
      if (filter.category && p.category !== filter.category) return false
      if (filter.sale && !p.oldPrice) return false
      if (filter.sizes.length > 0 && !filter.sizes.some((s) => p.sizes.includes(s))) {
        return false
      }
      if (query) {
        const q = query.toLowerCase()
        const name = localize(p.name).toLowerCase()
        if (!name.includes(q)) return false
      }
      return true
    })

    // Sorting happens after filtering so the grid always re-renders
    // instantly and in a single pass whenever the filter/sort state
    // changes — no separate re-fetch or animation delay is needed.
    if (filter.sort === 'price_asc') {
      result.sort((a, b) => a.price - b.price)
    } else if (filter.sort === 'price_desc') {
      result.sort((a, b) => b.price - a.price)
    }

    return result
  }, [products, filter, query, localize])

  // Counts are derived live from `products` on every render, and any group
  // or category with zero matching products is dropped from the filter bar
  // entirely — so a fully emptied catalog never leaves a stale/ghost chip
  // ("Sneakers", "Apparel", ...) with a count that no longer reflects reality.
  const groups = useMemo(
    () =>
      categoryTree.map((n) => ({
        key: n.group,
        label: localize(groupLabels[n.group] ?? {}),
        count: products.filter((p) => p.group === n.group).length,
      })).filter((g) => g.count > 0),
    [products, localize, categoryTree, groupLabels],
  )

  const categories = useMemo(() => {
    if (!filter.group) return []
    const items = categoryTree.find((n) => n.group === filter.group)?.items ?? []
    return items
      .map((c) => ({
        key: c,
        label: localize(categoryLabels[c] ?? {}),
        count: products.filter((p) => p.group === filter.group && p.category === c).length,
      }))
      .filter((c) => c.count > 0)
  }, [products, filter.group, localize, categoryTree, categoryLabels])

  const saleCount = useMemo(() => products.filter((p) => p.oldPrice).length, [products])

  function toggleSize(size: string) {
    setFilter({
      ...filter,
      sizes: filter.sizes.includes(size)
        ? filter.sizes.filter((s) => s !== size)
        : [...filter.sizes, size],
    })
  }

  const activeFilterCount =
    (filter.group ? 1 : 0) +
    (filter.category ? 1 : 0) +
    (filter.sale ? 1 : 0) +
    filter.sizes.length +
    (filter.sort !== 'default' ? 1 : 0)

  function clearAllFilters() {
    setFilter({ group: null, category: null, sale: false, sizes: [], sort: 'default' })
  }

  return (
    <section id="shop" className="mx-auto max-w-[1400px] scroll-mt-20 px-4 py-20 sm:px-6 lg:px-10">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('nav.shop')}
          </h2>
          <p className="mt-2 text-[12px] uppercase tracking-[0.15em] text-muted-foreground/50">
            {filtered.length} {t('filter.results')}
          </p>
        </div>

        {/* Sort dropdown — reorders the grid immediately, no page reload */}
        <label className="flex items-center gap-2 text-[12px] uppercase tracking-[0.1em] text-muted-foreground/70">
          {t('filter.sortBy')}
          <select
            value={filter.sort}
            onChange={(e) =>
              setFilter({ ...filter, sort: e.target.value as typeof filter.sort })
            }
            className="border border-border/60 bg-transparent px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-gold"
          >
            <option value="default">{t('filter.sortDefault')}</option>
            <option value="price_asc">{t('filter.sortPriceAsc')}</option>
            <option value="price_desc">{t('filter.sortPriceDesc')}</option>
          </select>
        </label>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border/40 pb-4">
        <FilterLink
          active={!filter.group && !filter.sale}
          onClick={() => setFilter({ ...filter, group: null, category: null, sale: false })}
        >
          {t('filter.all')} <span className="text-muted-foreground/40">· {products.length}</span>
        </FilterLink>
        {groups.map((g) => (
          <FilterLink
            key={g.key}
            active={filter.group === g.key && !filter.sale}
            onClick={() =>
              setFilter({
                ...filter,
                group: g.key,
                category: null,
                sale: false,
              })
            }
          >
            {g.label} <span className="text-muted-foreground/40">· {g.count}</span>
          </FilterLink>
        ))}
        {saleCount > 0 && (
          <>
            <span className="mx-1 h-3 w-px bg-border/60" />
            <FilterLink
              active={filter.sale}
              onClick={() => setFilter({ ...filter, sale: !filter.sale, group: null, category: null })}
              accent
            >
              {t('filter.sale')} <span className="text-muted-foreground/40">· {saleCount}</span>
            </FilterLink>
          </>
        )}

        <span className="mx-1 h-3 w-px bg-border/60" />

        {/* Size filter — multi-select; a product matches if it has ANY of
            the currently selected sizes. Updates the grid instantly. */}
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground/50">
            {t('filter.sizeLabel')}
          </span>
          {STANDARD_SIZES.map((size) => {
            const active = filter.sizes.includes(size)
            return (
              <button
                key={size}
                type="button"
                onClick={() => toggleSize(size)}
                className={cn(
                  'flex size-7 items-center justify-center border text-[11px] font-medium transition-colors duration-200',
                  active
                    ? 'border-gold bg-gold text-gold-foreground'
                    : 'border-border/60 text-muted-foreground/70 hover:border-foreground/40 hover:text-foreground',
                )}
              >
                {size}
              </button>
            )
          })}
        </div>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground/50 transition hover:text-destructive"
          >
            <X className="size-3" />
            {t('filter.clearAll')}
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground/50">
            <SlidersHorizontal className="size-3" />
            {t('filter.categoryLabel')}
          </span>
          {categories.map((c) => (
            <FilterLink
              key={c.key}
              active={filter.category === c.key}
              onClick={() =>
                setFilter({
                  ...filter,
                  category: filter.category === c.key ? null : c.key,
                })
              }
              small
            >
              {c.label} <span className="text-muted-foreground/40">· {c.count}</span>
            </FilterLink>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <p className="text-sm font-light text-muted-foreground">Ничего не найдено</p>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-[12px] uppercase tracking-[0.1em] text-gold hover:underline"
            >
              {t('filter.clearAll')}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-12 transition-all duration-300 sm:gap-x-7 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((product, i) => (
            <Reveal key={product.id} delay={(i % 8) * 70}>
              <ProductCard product={product} />
            </Reveal>
          ))}
        </div>
      )}
    </section>
  )
}

function FilterLink({
  active,
  onClick,
  children,
  accent,
  small,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  accent?: boolean
  small?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative tracking-wide transition-colors duration-300',
        small ? 'text-[12px]' : 'text-[13px]',
        active
          ? accent
            ? 'text-gold'
            : 'text-foreground'
          : accent
            ? 'text-muted-foreground/60 hover:text-gold/80'
            : 'text-muted-foreground/60 hover:text-foreground',
      )}
    >
      {children}
      {active && (
        <span className="absolute -bottom-[18px] left-0 right-0 h-px bg-gold" />
      )}
    </button>
  )
}
