'use client'

import { ChevronDown, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Reveal } from '@/components/reveal'
import { EMPTY_FILTER, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'
import { ProductCard } from './product-card'

const STANDARD_SIZES = ['S', 'M', 'L', 'XL']

/** How many products render before "show more". Enough to fill the grid on a
 *  large screen without pushing everything below into the DOM at once. */
const PAGE_SIZE = 12

function discountOf(p: Product): number {
  return p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0
}

/**
 * Can this be bought right now?
 *
 * A product with no variant rows is UNTRACKED, not sold out — the same
 * distinction the product page makes. Reading absent stock as zero here would
 * empty the grid the moment the availability filter was ticked.
 */
function isBuyable(p: Product): boolean {
  if (p.statuses.includes('out_of_stock')) return false
  if (!p.variants?.length) return true
  return p.variants.some((v) => v.stock > 0)
}

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
      if (
        filter.colors.length > 0 &&
        !filter.colors.some((c) => p.colors.some((pc) => pc.name === c))
      ) {
        return false
      }
      if (filter.minPrice !== null && p.price < filter.minPrice) return false
      if (filter.maxPrice !== null && p.price > filter.maxPrice) return false
      if (filter.inStockOnly && !isBuyable(p)) return false
      if (query) {
        // Matches the search box's reach — name, description, category and
        // collection — so typing in the header and pressing Enter narrows the
        // grid the way the dropdown ranked it. The stemming and typo
        // tolerance are server-side; this is the local approximation.
        const q = query.toLowerCase()
        const haystack = [
          localize(p.name),
          localize(p.description),
          localize(categoryLabels[p.category] ?? {}),
          localize(groupLabels[p.group] ?? {}),
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
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
    } else if (filter.sort === 'discount') {
      // Deepest percentage off first. A product with no old price has no
      // discount and sorts last rather than being dropped — the customer
      // asked for an order, not a filter.
      result.sort((a, b) => discountOf(b) - discountOf(a))
    } else if (filter.sort === 'newest') {
      // The catalogue already arrives newest-first from the server, and
      // `isNew` is the admin's own flag, so this lifts flagged products to the
      // top while preserving that order underneath.
      result.sort((a, b) => Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)))
    }

    return result
  }, [products, filter, query, localize, categoryLabels, groupLabels])

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

  function toggleColor(color: string) {
    setFilter({
      ...filter,
      colors: filter.colors.includes(color)
        ? filter.colors.filter((c) => c !== color)
        : [...filter.colors, color],
    })
  }

  /** Every colour in the catalogue, with a swatch. Derived rather than listed,
   *  so a colour the admin adds appears here without a code change. */
  const paletteColors = useMemo(() => {
    // A plain array with a Set of seen names: the project targets ES5, where
    // spreading a Map iterator needs --downlevelIteration.
    const seen = new Set<string>()
    const out: { name: string; hex: string }[] = []
    for (const p of products) {
      for (const c of p.colors) {
        if (c.name && !seen.has(c.name)) {
          seen.add(c.name)
          out.push({ name: c.name, hex: c.hex })
        }
      }
    }
    return out
  }, [products])

  /** Bounds for the price inputs, from the catalogue itself. */
  const priceBounds = useMemo(() => {
    if (products.length === 0) return { min: 0, max: 0 }
    const prices = products.map((p) => p.price)
    return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) }
  }, [products])

  const activeFilterCount =
    (filter.group ? 1 : 0) +
    (filter.category ? 1 : 0) +
    (filter.sale ? 1 : 0) +
    filter.sizes.length +
    filter.colors.length +
    (filter.minPrice !== null || filter.maxPrice !== null ? 1 : 0) +
    (filter.inStockOnly ? 1 : 0) +
    (filter.sort !== 'default' ? 1 : 0)

  function clearAllFilters() {
    // One shared definition, so "clear all" cannot drift from the initial
    // state the way it did before — a cleared filter used to keep its sizes.
    setFilter(EMPTY_FILTER)
  }

  /**
   * Paging.
   *
   * The grid rendered every product at once. Fine at three, not at three
   * hundred: every card mounts an optimised image and the browser lays out the
   * lot before painting anything.
   *
   * "Show more" rather than numbered pages, deliberately — numbered pages want
   * their own URLs to be useful, and a URL per filter combination is exactly
   * the SEO duplication this catalogue should not create. See the robots note
   * in app/robots.ts.
   */
  const [visible, setVisible] = useState(PAGE_SIZE)

  // Any change to the filters starts the list again; keeping a deep scroll
  // position across a filter change shows the customer page three of results
  // they have not seen page one of.
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [filter, query])

  const shown = filtered.slice(0, visible)

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

        {/* Sort dropdown — reorders the grid immediately, no page reload.
            `appearance-none` plus our own chevron is the point: every engine
            draws a different-width native arrow (Safari's is the widest), and
            the label text runs underneath it. Removing it makes the reserved
            space `pr-9` and identical everywhere. */}
        <label className="flex min-w-fit shrink-0 items-center gap-2 whitespace-nowrap text-[12px] uppercase tracking-[0.1em] text-muted-foreground/70">
          {t('filter.sortBy')}
          <span className="relative inline-block">
            <select
              value={filter.sort}
              onChange={(e) =>
                setFilter({ ...filter, sort: e.target.value as typeof filter.sort })
              }
              className="w-full min-w-[180px] cursor-pointer appearance-none truncate whitespace-nowrap border border-border/60 bg-transparent py-1.5 pl-2.5 pr-9 text-[12px] text-foreground outline-none transition focus:border-gold"
            >
              {/* Options inherit the page's dark palette in some engines and the
                  system one in others, so their colours are set explicitly —
                  otherwise the list can render white-on-white. */}
              <option value="default" className="bg-background text-foreground">
                {t('filter.sortDefault')}
              </option>
              <option value="newest" className="bg-background text-foreground">
                {t('filter.sortNewest')}
              </option>
              <option value="price_asc" className="bg-background text-foreground">
                {t('filter.sortPriceAsc')}
              </option>
              <option value="price_desc" className="bg-background text-foreground">
                {t('filter.sortPriceDesc')}
              </option>
              <option value="discount" className="bg-background text-foreground">
                {t('filter.sortDiscount')}
              </option>
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              strokeWidth={1.5}
              aria-hidden
            />
          </span>
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

        {/* Colour — same multi-select behaviour as sizes. The swatch is the
            label: a list of colour names in a monochrome UI tells a customer
            far less than the colour itself. */}
        {paletteColors.length > 1 && (
          <>
            <span className="mx-1 h-3 w-px bg-border/60" />
            <div className="flex items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground/50">
                {t('filter.colorLabel')}
              </span>
              {paletteColors.map((c) => {
                const active = filter.colors.includes(c.name)
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => toggleColor(c.name)}
                    aria-pressed={active}
                    aria-label={c.name}
                    title={c.name}
                    className={cn(
                      'size-6 rounded-full border transition-all duration-200',
                      active
                        ? 'border-gold ring-1 ring-gold/40 ring-offset-2 ring-offset-background'
                        : 'border-border/60 hover:border-foreground/40',
                    )}
                    style={{ backgroundColor: c.hex }}
                  />
                )
              })}
            </div>
          </>
        )}

        {/* Availability. Off by default: most people browsing want to see the
            whole range, and hiding sold-out items by default makes a catalogue
            look smaller than it is. */}
        <span className="mx-1 h-3 w-px bg-border/60" />
        <FilterLink
          active={filter.inStockOnly}
          onClick={() => setFilter({ ...filter, inStockOnly: !filter.inStockOnly })}
        >
          {t('filter.inStockOnly')}
        </FilterLink>

        {/* Price. Two loose bounds rather than a slider — a slider needs a
            known, dense range to feel right, and typing "under 300" is faster
            than dragging to it. */}
        {priceBounds.max > priceBounds.min && (
          <>
            <span className="mx-1 h-3 w-px bg-border/60" />
            <div className="flex items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground/50">
                {t('filter.priceLabel')}
              </span>
              <PriceInput
                value={filter.minPrice}
                placeholder={String(priceBounds.min)}
                ariaLabel={t('filter.priceMin')}
                onChange={(v) => setFilter({ ...filter, minPrice: v })}
              />
              <span className="text-muted-foreground/40">—</span>
              <PriceInput
                value={filter.maxPrice}
                placeholder={String(priceBounds.max)}
                ariaLabel={t('filter.priceMax')}
                onChange={(v) => setFilter({ ...filter, maxPrice: v })}
              />
            </div>
          </>
        )}

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
          <SearchX className="size-8 text-muted-foreground/25" strokeWidth={1.25} />
          {/* Was a hardcoded Russian string on a site that ships five
              languages, so four out of five customers met a dead end in a
              language they had not chosen. */}
          <p className="text-sm font-light text-muted-foreground">{t('filter.noResults')}</p>
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
        <>
          <div className="grid grid-cols-2 gap-x-5 gap-y-12 transition-all duration-300 sm:gap-x-7 md:grid-cols-3 xl:grid-cols-4">
            {shown.map((product, i) => (
              <Reveal key={product.id} delay={(i % 8) * 70}>
                <ProductCard product={product} />
              </Reveal>
            ))}
          </div>

          {visible < filtered.length && (
            <div className="mt-14 flex flex-col items-center gap-3">
              <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground/50">
                {shown.length} / {filtered.length}
              </p>
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                className="border border-gold/40 bg-gold/5 px-8 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
              >
                {t('filter.showMore')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/**
 * One end of the price range.
 *
 * `number | null` rather than a number with a sentinel: 0 is a legitimate
 * minimum, so conflating it with "unset" would make the field impossible to
 * clear once typed into.
 */
function PriceInput({
  value,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: number | null
  placeholder: string
  ariaLabel: string
  onChange: (v: number | null) => void
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      value={value ?? ''}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = e.target.value.trim()
        onChange(raw === '' ? null : Math.max(0, Number(raw) || 0))
      }}
      className="w-20 border border-border/60 bg-transparent px-2 py-1 text-[12px] tabular-nums text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-gold"
    />
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
