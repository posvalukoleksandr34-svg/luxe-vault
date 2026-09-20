'use client'

import { Clock, Loader2, Search, SearchX, TrendingUp, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { trackSearch } from '@/lib/analytics'
import { isProductBuyable } from '@/lib/availability'
import { formatMoney } from '@/lib/currency'
import {
  STATUS_LABELS,
  STYLIST_COLOR_LABELS,
  STYLIST_FIT_LABELS,
  STYLIST_OCCASION_LABELS,
  STYLIST_STYLE_LABELS,
} from '@/lib/i18n'
import { clearRecentSearches, readRecentSearches, rememberSearch } from '@/lib/recent-searches'
import { productImage } from '@/lib/product-image'
import {
  buildSearchContext,
  interpretQuery,
  normalizeText,
  removePhrase,
  type SearchFilter,
} from '@/lib/search/interpret'
import { matchProducts, productHaystack, type RelaxedKind } from '@/lib/search/match'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

/**
 * The catalogue search box, with suggestions.
 *
 * Replaces a bare input that set a store filter and nothing else. Ranking,
 * stemming and typo tolerance happen in Postgres (migration 0017); natural
 * requests — "black oversized jacket under €200" — are read into filters
 * (lib/search/interpret.ts) and shown as chips the shopper can take off one
 * at a time. This component's job is to ask at the right moment and show the
 * answer well.
 *
 * WHAT THE PANEL SHOWS, AND WHEN
 *
 *   empty query   recent searches (local) and popular ones (aggregate)
 *   typing        matching products, ranked — with the understood filters
 *   no matches    a plain empty state plus something to click, because a dead
 *                 end on a search box is a lost sale
 *
 * NEVER BROKEN. If the request fails — offline, throttled, a server error —
 * the same reading is applied to the catalogue already in the browser.
 *
 * The store's `query` is still updated, so the grid below stays in sync for
 * anyone who ignores the dropdown and just presses Enter.
 */

const DEBOUNCE_MS = 220
/** A model-assisted reading is asked for only once typing has paused. */
const AI_SETTLE_MS = 700
const MAX_RESULTS = 24

type Reading = { filters: SearchFilter[]; keywords: string[]; relaxed: RelaxedKind[] }
type Found = { results: Product[]; total: number; fuzzy: boolean; reading: Reading | null }
const NOTHING: Found = { results: [], total: 0, fuzzy: false, reading: null }

export function SearchBox({
  variant = 'desktop',
  onNavigate,
}: {
  variant?: 'desktop' | 'mobile'
  /** Lets the header close its mobile panel when a result is clicked. */
  onNavigate?: () => void
}) {
  const {
    query,
    setQuery,
    localize,
    t,
    tf,
    products,
    categories,
    categoryLabels,
    groupLabels,
    currency,
  } = useStore()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [found, setFound] = useState<Found>(NOTHING)
  const [popular, setPopular] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRecent(readRecentSearches())
  }, [open])

  // Click-away. The panel overlays the page, so leaving it open after a click
  // elsewhere would cover content the customer just chose to look at.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /** The same search, run on the catalogue this browser already holds. */
  function searchLocally(term: string): Found {
    const reading = interpretQuery(
      term,
      buildSearchContext({
        products,
        categoryLabels,
        groupLabels,
        categorySlugs: categories.map((c) => c.slug),
        currency,
      }),
    )
    if (reading.filters.length > 0) {
      const m = matchProducts(products, reading)
      return {
        results: m.products.slice(0, MAX_RESULTS),
        total: m.products.length,
        fuzzy: false,
        reading: { ...reading, relaxed: m.relaxed },
      }
    }
    const q = normalizeText(term)
    const hits = products.filter((p) => productHaystack(p).indexOf(q) !== -1)
    return { results: hits.slice(0, MAX_RESULTS), total: hits.length, fuzzy: false, reading: null }
  }

  /**
   * Debounced fetch.
   *
   * Without the delay every keystroke is a database query and the answers
   * arrive out of order — "co", "coa", "coat" can resolve as "coat", "co",
   * "coa", leaving the wrong results on screen. The abort controller closes
   * that race for anything the debounce lets through.
   */
  useEffect(() => {
    const term = query.trim()

    if (term.length < 2) {
      setFound(NOTHING)
      setLoading(false)
      // Popular searches are worth having ready before the customer types.
      if (open && popular.length === 0) {
        fetch('/api/search?q=')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.popular && setPopular(d.popular))
          .catch(() => {})
      }
      return
    }

    setLoading(true)
    const controller = new AbortController()
    let aiTimer: ReturnType<typeof setTimeout> | undefined
    const url = `/api/search?q=${encodeURIComponent(term)}&cur=${currency}`

    async function ask(href: string) {
      const res = await fetch(href, { signal: controller.signal })
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    }

    function show(data: {
      results?: Product[]
      total?: number
      fuzzy?: boolean
      popular?: string[]
      interpretation?: Reading
    }) {
      const results = data.results ?? []
      setFound({
        results,
        total: data.total ?? results.length,
        fuzzy: Boolean(data.fuzzy),
        reading: data.interpretation?.filters?.length ? data.interpretation : null,
      })
      if (data.popular?.length) setPopular(data.popular)
      trackSearch(term, results.length)
      if (results.length) rememberSearch(term)
    }

    const timer = setTimeout(() => {
      ask(url)
        .then((data) => {
          show(data)
          // Words the rules could not place: once typing has settled, ask
          // again with the model's help. Until then — and if it fails — the
          // rules' answer stands.
          if (data?.aiEligible) {
            aiTimer = setTimeout(() => {
              ask(`${url}&ai=1`)
                .then((next) => {
                  if (next?.interpretation?.ai) show(next)
                })
                .catch(() => {})
            }, AI_SETTLE_MS)
          }
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return
          // Offline, throttled or a server error: search what is already here.
          setFound(searchLocally(term))
        })
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
      if (aiTimer) clearTimeout(aiTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, currency])

  const term = query.trim()
  const { results, total, fuzzy, reading } = found
  const showSuggestions = term.length < 2
  const showEmptyState = !loading && term.length >= 2 && results.length === 0

  function choose(next: string) {
    setQuery(next)
  }

  function close() {
    setOpen(false)
    onNavigate?.()
  }

  /** The chip for one understood filter, in the visitor's language. */
  function chipLabel(f: SearchFilter): string {
    switch (f.kind) {
      case 'color':
        return localize(STYLIST_COLOR_LABELS[f.value])
      case 'fit':
        return localize(STYLIST_FIT_LABELS[f.value])
      case 'style':
        return localize(STYLIST_STYLE_LABELS[f.value])
      case 'occasion':
        return localize(STYLIST_OCCASION_LABELS[f.value])
      case 'category':
        return localize(categoryLabels[f.value[0]] ?? {}) || f.value[0]
      case 'group':
        return localize(groupLabels[f.value] ?? {}) || f.value
      case 'brand':
        return f.value
      case 'maxPrice':
        return tf('search.under', { amount: formatMoney(f.value, f.currency) })
      case 'minPrice':
        return tf('search.over', { amount: formatMoney(f.value, f.currency) })
      case 'inStock':
        return localize(STATUS_LABELS.in_stock)
    }
  }

  // What was let go to find anything at all, said plainly.
  const relaxedText = reading
    ? reading.relaxed
        .map((kind) =>
          kind === 'keywords'
            ? reading.keywords.map((w) => `“${w}”`).join(' ')
            : reading.filters
                .filter((f) => f.kind === kind)
                .map(chipLabel)
                .join(', '),
        )
        .filter(Boolean)
        .join(', ')
    : ''

  return (
    <div ref={containerRef} className={cn('relative', variant === 'mobile' && 'w-full')}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      {/* A plain search field that controls the panel below — not an ARIA
          combobox, which would promise arrow-key option navigation the panel
          of links and chips does not have. */}
      <input
        ref={inputRef}
        type="search"
        name="q"
        enterKeyHint="search"
        aria-controls="search-suggestions"
        aria-label={t('filter.search')}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('filter.search')}
        className={cn(
          // outline-none is replaced, not dropped: focus draws a gold border.
          'text-foreground outline-none transition-[width,border-color] duration-300 placeholder:text-muted-foreground/60',
          variant === 'desktop'
            ? 'w-36 border border-transparent bg-transparent py-2 pl-9 pr-8 text-[13px] focus:w-56 focus:border-gold/50'
            : 'w-full rounded-full border border-border bg-card/50 py-2.5 pl-9 pr-8 text-sm focus:border-gold/60',
        )}
      />

      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            setFound(NOTHING)
          }}
          aria-label={t('search.clear')}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-muted-foreground/60 transition hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}

      {/* One announcement for screen readers as results change: searching,
          how many were found, or that nothing was. */}
      <p className="sr-only" aria-live="polite">
        {open && term.length >= 2
          ? loading
            ? t('search.searching')
            : results.length
              ? tf('search.count', { n: total })
              : t('search.noResults')
          : ''}
      </p>

      {open && (
        <div
          id="search-suggestions"
          role="region"
          aria-label={t('search.panel')}
          className={cn(
            'absolute z-[120] mt-2 max-h-[70vh] overflow-y-auto overscroll-contain border border-border bg-popover shadow-xl',
            variant === 'desktop' ? 'right-0 w-[24rem]' : 'left-0 right-0 w-full',
          )}
        >
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 aria-hidden className="size-4 animate-spin text-gold" />
            </div>
          )}

          {/* Suggestions, before anything is typed */}
          {!loading && showSuggestions && (
            <div className="p-3">
              {recent.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      <Clock aria-hidden className="size-3" />
                      {t('search.recent')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        clearRecentSearches()
                        setRecent([])
                      }}
                      className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80 transition hover:text-foreground"
                    >
                      {t('search.clearRecent')}
                    </button>
                  </div>
                  <TermList terms={recent} onPick={choose} />
                </div>
              )}

              {popular.length > 0 && (
                <div>
                  <span className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    <TrendingUp aria-hidden className="size-3" />
                    {t('search.popular')}
                  </span>
                  <TermList terms={popular} onPick={choose} />
                </div>
              )}

              {recent.length === 0 && popular.length === 0 && (
                <p className="py-3 text-center text-[12px] font-light text-muted-foreground">
                  {t('search.hint')}
                </p>
              )}
              <p className="mt-3 border-t border-border/40 pt-2.5 text-[11px] font-light text-muted-foreground/80">
                {t('search.hintSmart')}
              </p>
            </div>
          )}

          {/* What the query was understood as — each filter removable */}
          {!loading && !showSuggestions && reading && (
            <div className="border-b border-border/50 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {reading.filters.map((f, i) => {
                  const label = chipLabel(f)
                  return (
                    <button
                      key={`${f.kind}-${i}`}
                      type="button"
                      onClick={() => {
                        setQuery(removePhrase(query, f.phrase))
                        // The chip unmounts; keep the keyboard where the
                        // shopper is working rather than dropping it to <body>.
                        inputRef.current?.focus()
                      }}
                      aria-label={`${t('search.removeFilter')}: ${label}`}
                      // The chip stays slim; its tap target is 26px tall
                      // through an invisible band above and below.
                      className="group relative flex items-center gap-1 border border-gold/30 px-2 py-[3px] text-[10px] uppercase tracking-[0.14em] text-gold/90 transition-colors before:absolute before:inset-x-0 before:-inset-y-[3px] before:content-[''] hover:border-gold hover:text-gold"
                    >
                      {label}
                      <X aria-hidden className="size-2.5 opacity-50 transition-opacity group-hover:opacity-100" />
                    </button>
                  )
                })}
                <span className="ml-auto text-[10px] uppercase tracking-[0.14em] tabular-nums text-muted-foreground">
                  {tf('search.count', { n: total })}
                </span>
              </div>
              {relaxedText && results.length > 0 && (
                <p className="mt-2 text-[11px] font-light text-muted-foreground">
                  {tf('search.relaxed', { what: relaxedText })}
                </p>
              )}
            </div>
          )}

          {/* Results */}
          {!loading && results.length > 0 && (
            <>
              {fuzzy && (
                <p className="border-b border-border/50 px-3 py-2 text-[11px] font-light text-muted-foreground">
                  {t('search.didYouMean')}
                </p>
              )}
              <ul>
                {results.map((p) => {
                  const buyable = isProductBuyable(p)
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/product/${encodeURIComponent(p.id)}`}
                        onClick={close}
                        className="flex items-center gap-3 border-b border-border/40 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-accent/40"
                      >
                        <span className="relative size-11 shrink-0 overflow-hidden border border-border/60">
                          <Image
                            src={productImage(p.image)}
                            alt=""
                            fill
                            sizes="44px"
                            className={cn('object-cover', !buyable && 'opacity-50 grayscale')}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-light text-foreground">
                            {localize(p.name)}
                          </span>
                          <span className="block text-[11px] tabular-nums text-muted-foreground/80">
                            {formatPrice(p.price)}
                            {!buyable && <span className="text-muted-foreground/80"> · {t('sold.out')}</span>}
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {/* Nothing found — never a dead end */}
          {showEmptyState && (
            <div className="flex flex-col items-center gap-3 px-4 py-7 text-center">
              <SearchX aria-hidden className="size-6 text-muted-foreground/30" strokeWidth={1.25} />
              <p className="text-[12px] font-light text-muted-foreground">
                {t('search.noResults')}
              </p>
              {popular.length > 0 && (
                <div className="w-full">
                  <span className="mb-1.5 block text-[10px] uppercase tracking-[0.15em] text-muted-foreground/80">
                    {t('search.tryInstead')}
                  </span>
                  <TermList terms={popular} onPick={choose} />
                </div>
              )}
              <Link
                href="/catalog"
                onClick={close}
                className="mt-1 border border-gold/40 bg-gold/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gold transition-colors duration-300 hover:bg-gold hover:text-gold-foreground"
              >
                {t('search.browseAll')}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TermList({ terms, onPick }: { terms: string[]; onPick: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {terms.map((term) => (
        <button
          key={term}
          type="button"
          onClick={() => onPick(term)}
          className="border border-border px-2.5 py-1 text-[11px] font-light text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground"
        >
          {term}
        </button>
      ))}
    </div>
  )
}
