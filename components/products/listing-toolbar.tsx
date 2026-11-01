'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { getRates } from '@/lib/currency'
import type { UIKey } from '@/lib/i18n'
import { formatPrice, useStore, type Filter, type SortKey } from '@/lib/store'
import { cn } from '@/lib/utils'

/** One option of a facet, with how many products in view carry it. */
export type FacetOption = { key: string; label: string; count: number }

/**
 * What the products on a category page can actually be filtered by — each
 * facet derived from those products, so no control offers a value nothing on
 * the page has (ProductGrid builds it).
 */
export type ListingFacets = {
  /** The department's own subcategories; empty on a subcategory page. */
  categories: FacetOption[]
  /** Sizes carried by these products, in size order. */
  sizes: string[]
  colors: { name: string; hex: string }[]
  /** CHF, from the products' own prices. */
  price: { min: number; max: number }
  /** Products with a real reduction (discountPercent > 0). */
  saleCount: number
}

type Props = {
  total: number
  facets: ListingFacets
  filter: Filter
  /** `smooth` false for typing, where a crossfade per keystroke would stutter. */
  onChange: (next: Filter, smooth?: boolean) => void
  onClear: () => void
}

/**
 * The toolbar of a category page: the count, a Filters button, the sort, and
 * the filters in force as chips that each remove themselves.
 *
 * The filters live in a side panel (FilterPanel) at every width — full screen
 * on a phone, a column from the right on larger screens — rather than in a
 * wrapped row of controls: the row had grown to five facets and, on a phone,
 * three lines of small targets above the first product. What is chosen stays
 * visible without opening anything, as the chips.
 *
 * Every change applies at once and is written to the address bar
 * (FilterUrlSync), so a filtered page can be shared, reloaded and walked back
 * through. Clearing removes the refinements; the department or category
 * itself is the route and stays.
 */
export function ListingToolbar({ total, facets, filter, onChange, onClear }: Props) {
  const { t, tf, colorName } = useStore()
  const [open, setOpen] = useState(false)

  const chips = activeChips(filter, facets, { t, colorName })
  const refinements = chips.length

  // "Biggest discount" orders by real reductions; with none in view it would
  // be the default order under another name. Kept when a link asked for it,
  // so the select never shows a value it has no option for.
  const sorts: { key: SortKey; label: string }[] = [
    { key: 'default', label: t('filter.sortDefault') },
    { key: 'newest', label: t('filter.sortNewest') },
    { key: 'price_asc', label: t('filter.sortPriceAsc') },
    { key: 'price_desc', label: t('filter.sortPriceDesc') },
    ...(facets.saleCount > 0 || filter.sort === 'discount'
      ? [{ key: 'discount' as SortKey, label: t('filter.sortDiscount') }]
      : []),
  ]

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border/50 pb-4">
        <p
          className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground/85"
          aria-live="polite"
          data-testid="listing-count"
        >
          {total} {t(total === 1 ? 'filter.resultsOne' : 'filter.results')}
        </p>

        <div className="flex items-center gap-2 sm:gap-3">
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger asChild>
              <button
                type="button"
                className="flex h-9 items-center gap-2 border border-border/70 px-3.5 text-[12px] uppercase tracking-[0.12em] text-foreground transition-colors hover:border-gold/60"
              >
                <SlidersHorizontal className="size-3.5" strokeWidth={1.5} aria-hidden />
                {t('filter.button')}
                {refinements > 0 && (
                  <span className="flex size-[18px] items-center justify-center rounded-full bg-gold text-[10px] font-medium tabular-nums text-gold-foreground">
                    {refinements}
                  </span>
                )}
              </button>
            </DialogPrimitive.Trigger>
            <FilterPanel
              total={total}
              facets={facets}
              filter={filter}
              onChange={onChange}
              onClear={onClear}
              onDone={() => setOpen(false)}
            />
          </DialogPrimitive.Root>

          {/* `appearance-none` plus our own chevron: every engine draws a
              different-width native arrow, and the label ran under Safari's. */}
          <label className="flex items-center gap-2 whitespace-nowrap text-[12px] uppercase tracking-[0.1em] text-muted-foreground/85">
            <span className="sr-only sm:not-sr-only">{t('filter.sortBy')}</span>
            <span className="relative inline-block">
              <select
                value={filter.sort}
                aria-label={t('filter.sortBy')}
                onChange={(e) => onChange({ ...filter, sort: e.target.value as SortKey })}
                className="h-9 w-[168px] cursor-pointer appearance-none truncate border border-border/70 bg-transparent pl-3 pr-9 text-[12px] normal-case tracking-normal text-foreground outline-none transition focus:border-gold sm:w-[188px]"
              >
                {sorts.map((s) => (
                  <option key={s.key} value={s.key} className="bg-background text-foreground">
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/85"
                strokeWidth={1.5}
                aria-hidden
              />
            </span>
          </label>
        </div>
      </div>

      {refinements > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t('filter.active')}>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onChange(chip.remove(filter))}
              aria-label={tf('filter.remove', { name: chip.label })}
              className="group flex h-8 items-center gap-1.5 border border-border/70 bg-secondary/60 pl-3 pr-2 text-[12px] text-foreground transition-colors hover:border-gold/60"
            >
              {chip.swatch && (
                <span
                  aria-hidden
                  className="size-3 rounded-full border border-border/70"
                  style={{ backgroundColor: chip.swatch }}
                />
              )}
              {chip.label}
              <X className="size-3.5 text-muted-foreground group-hover:text-foreground" strokeWidth={1.5} aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="tap-safe ml-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
          >
            {t('filter.clearAll')}
          </button>
        </div>
      )}
    </div>
  )
}

type Chip = { id: string; label: string; swatch?: string; remove: (f: Filter) => Filter }

/** The refinements in force, each with the filter it leaves when removed. */
function activeChips(
  filter: Filter,
  facets: ListingFacets,
  { t: tr, colorName }: { t: (key: UIKey) => string; colorName: (name: string) => string },
): Chip[] {
  const chips: Chip[] = []
  for (const slug of filter.categories) {
    const label = facets.categories.find((c) => c.key === slug)?.label ?? slug
    chips.push({ id: `cat:${slug}`, label, remove: (f) => ({ ...f, categories: f.categories.filter((c) => c !== slug) }) })
  }
  for (const size of filter.sizes) {
    chips.push({
      id: `size:${size}`,
      label: `${tr('filter.sizeLabel')}: ${size}`,
      remove: (f) => ({ ...f, sizes: f.sizes.filter((s) => s !== size) }),
    })
  }
  for (const name of filter.colors) {
    const swatch = facets.colors.find((c) => c.name === name)?.hex
    chips.push({
      id: `color:${name}`,
      label: colorName(name) || name,
      swatch,
      remove: (f) => ({ ...f, colors: f.colors.filter((c) => c !== name) }),
    })
  }
  if (filter.minPrice !== null || filter.maxPrice !== null) {
    const label =
      filter.minPrice !== null && filter.maxPrice !== null
        ? `${formatPrice(filter.minPrice)} – ${formatPrice(filter.maxPrice)}`
        : filter.minPrice !== null
          ? `${tr('filter.priceMin')} ${formatPrice(filter.minPrice)}`
          : `${tr('filter.priceMax')} ${formatPrice(filter.maxPrice as number)}`
    chips.push({ id: 'price', label, remove: (f) => ({ ...f, minPrice: null, maxPrice: null }) })
  }
  if (filter.inStockOnly) {
    chips.push({ id: 'stock', label: tr('filter.inStockOnly'), remove: (f) => ({ ...f, inStockOnly: false }) })
  }
  if (filter.sale) {
    chips.push({ id: 'sale', label: tr('filter.sale'), remove: (f) => ({ ...f, sale: false }) })
  }
  return chips
}

/**
 * The filter panel. A Radix dialog, so it traps focus while open, closes on
 * Escape and on the scrim, locks the page's scroll, and hands focus back to
 * the Filters button when it closes.
 */
function FilterPanel({
  total,
  facets,
  filter,
  onChange,
  onClear,
  onDone,
}: Props & { onDone: () => void }) {
  const { t, tf, colorName, currency } = useStore()
  // Applied at once, without the results crossfade the toolbar uses: the
  // grid is behind the panel, and waiting for the transition's snapshot left
  // a ticked box looking unticked for a moment.
  const apply = (next: Filter) => onChange(next, false)

  const toggle = (list: string[], value: string) =>
    list.indexOf(value) === -1 ? [...list, value] : list.filter((v) => v !== value)

  // The price fields are in the currency the prices are shown in; the filter
  // (and the address) keeps CHF, the currency the catalogue is priced in.
  const rate = getRates()[currency] ?? 1
  const shown = (chf: number | null) => (chf === null ? '' : String(Math.round(chf * rate)))
  const toChf = (raw: string): number | null => {
    const n = Number(raw.trim())
    if (raw.trim() === '' || !Number.isFinite(n) || n < 0) return null
    return Math.round((n / rate) * 100) / 100
  }
  const hasRange = facets.price.max > facets.price.min

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="motion-radix-scrim fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className="motion-radix-drawer fixed inset-y-0 right-0 z-[100] flex w-full flex-col border-l border-border bg-popover outline-none sm:max-w-[420px]"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 sm:px-6">
          <DialogPrimitive.Title className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {t('filter.button')}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label={t('filter.close')}
            className="tap-safe -mr-2 flex size-9 items-center justify-center text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-5" strokeWidth={1.5} aria-hidden />
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="sr-only">
          {tf('filter.showResults', { n: total })}
        </DialogPrimitive.Description>

        <div className="flex-1 overflow-y-auto px-5 py-2 sm:px-6">
          {facets.categories.length > 1 && (
            <Section title={t('filter.categoryLabel')}>
              <ul className="flex flex-col gap-1">
                {facets.categories.map((c) => {
                  const checked = filter.categories.indexOf(c.key) !== -1
                  return (
                    <li key={c.key}>
                      <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-[14px] text-foreground">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => apply({ ...filter, categories: toggle(filter.categories, c.key) })}
                          className="size-4 shrink-0 accent-gold"
                        />
                        <span className="flex-1">{c.label}</span>
                        <span className="text-[12px] tabular-nums text-muted-foreground">{c.count}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}

          {facets.sizes.length > 0 && (
            <Section title={t('filter.sizeLabel')}>
              <div className="flex flex-wrap gap-2">
                {facets.sizes.map((size) => {
                  const active = filter.sizes.indexOf(size) !== -1
                  return (
                    <button
                      key={size}
                      type="button"
                      aria-pressed={active}
                      onClick={() => apply({ ...filter, sizes: toggle(filter.sizes, size) })}
                      className={cn(
                        'flex h-10 min-w-[48px] items-center justify-center border px-3 text-[13px] transition-colors',
                        active
                          ? 'border-gold bg-gold text-gold-foreground'
                          : 'border-border/70 text-foreground hover:border-foreground/50',
                      )}
                    >
                      {size}
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {facets.colors.length > 1 && (
            <Section title={t('filter.colorLabel')}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {facets.colors.map((c) => {
                  const active = filter.colors.indexOf(c.name) !== -1
                  const name = colorName(c.name) || c.name
                  return (
                    <button
                      key={c.name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => apply({ ...filter, colors: toggle(filter.colors, c.name) })}
                      className="flex min-h-[40px] items-center gap-3 text-left text-[14px] text-foreground"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'size-5 shrink-0 rounded-full border transition',
                          active
                            ? 'border-gold ring-1 ring-gold/50 ring-offset-2 ring-offset-popover'
                            : 'border-border/70',
                        )}
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className={cn('truncate', active && 'text-gold')}>{name}</span>
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {hasRange && (
            <Section title={`${t('filter.priceLabel')}, ${currency}`}>
              <div className="flex items-center gap-3">
                <PriceField
                  label={t('filter.priceMin')}
                  value={shown(filter.minPrice)}
                  placeholder={String(Math.floor(facets.price.min * rate))}
                  onChange={(raw) => apply({ ...filter, minPrice: toChf(raw) })}
                />
                <span aria-hidden className="text-muted-foreground">—</span>
                <PriceField
                  label={t('filter.priceMax')}
                  value={shown(filter.maxPrice)}
                  placeholder={String(Math.ceil(facets.price.max * rate))}
                  onChange={(raw) => apply({ ...filter, maxPrice: toChf(raw) })}
                />
              </div>
            </Section>
          )}

          <Section title={t('filter.availability')}>
            <Toggle
              label={t('filter.inStockOnly')}
              checked={filter.inStockOnly}
              onChange={(v) => apply({ ...filter, inStockOnly: v })}
            />
            {facets.saleCount > 0 && (
              <Toggle
                label={`${t('filter.onSaleOnly')} · ${facets.saleCount}`}
                checked={filter.sale}
                onChange={(v) => apply({ ...filter, sale: v })}
              />
            )}
          </Section>
        </div>

        <div className="flex gap-3 border-t border-border/60 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClear}
            className="h-12 flex-1 border border-border/70 text-[12px] uppercase tracking-[0.12em] text-foreground transition hover:border-foreground/50"
          >
            {t('filter.clearAll')}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="h-12 flex-[1.4] bg-gold-gradient text-[12px] font-medium uppercase tracking-[0.12em] text-gold-foreground shadow-gold transition hover:brightness-[1.05]"
          >
            {tf('filter.showResults', { n: total })}
          </button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-b border-border/50 py-5 last:border-b-0">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
      {children}
    </fieldset>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4 text-[14px] text-foreground">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 shrink-0 accent-gold"
      />
    </label>
  )
}

function PriceField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (raw: string) => void
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full min-w-0 border border-border/70 bg-transparent px-3 text-[14px] tabular-nums text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-gold"
    />
  )
}
