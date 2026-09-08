'use client'

import { Clock, Loader2, Search, SearchX, TrendingUp, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { trackSearch } from '@/lib/analytics'
import { clearRecentSearches, readRecentSearches, rememberSearch } from '@/lib/recent-searches'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

/**
 * The catalogue search box, with suggestions.
 *
 * Replaces a bare input that set a store filter and nothing else. Ranking,
 * stemming and typo tolerance all happen in Postgres — see migration 0017 —
 * so this component's job is only to ask at the right moment and show the
 * answer well.
 *
 * WHAT THE PANEL SHOWS, AND WHEN
 *
 *   empty query   recent searches (local) and popular ones (aggregate)
 *   typing        matching products, ranked
 *   no matches    a plain empty state plus something to click, because a dead
 *                 end on a search box is a lost sale
 *
 * The store's `query` is still updated, so the grid below stays in sync for
 * anyone who ignores the dropdown and just presses Enter.
 */

const DEBOUNCE_MS = 220

export function SearchBox({
  variant = 'desktop',
  onNavigate,
}: {
  variant?: 'desktop' | 'mobile'
  /** Lets the header close its mobile panel when a result is clicked. */
  onNavigate?: () => void
}) {
  const { query, setQuery, localize, t } = useStore()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Product[]>([])
  const [fuzzy, setFuzzy] = useState(false)
  const [popular, setPopular] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])

  const containerRef = useRef<HTMLDivElement>(null)

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
      setResults([])
      setFuzzy(false)
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
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return
          setResults(data.results ?? [])
          setFuzzy(Boolean(data.fuzzy))
          if (data.popular?.length) setPopular(data.popular)
          trackSearch(term, data.results?.length ?? 0)
          if (data.results?.length) {
            rememberSearch(term)
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open])

  const term = query.trim()
  const showSuggestions = term.length < 2
  const showEmptyState = !loading && term.length >= 2 && results.length === 0

  function choose(next: string) {
    setQuery(next)
  }

  function close() {
    setOpen(false)
    onNavigate?.()
  }

  return (
    <div ref={containerRef} className={cn('relative', variant === 'mobile' && 'w-full')}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
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
          'text-foreground outline-none transition-all duration-300 placeholder:text-muted-foreground/60',
          variant === 'desktop'
            ? 'w-36 border border-transparent bg-transparent py-2 pl-9 pr-8 text-[13px] focus:w-56 focus:border-border'
            : 'w-full rounded-full border border-border bg-card/50 py-2.5 pl-9 pr-8 text-sm focus:border-gold/30',
        )}
      />

      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            setResults([])
          }}
          aria-label={t('search.clear')}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-muted-foreground/60 transition hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}

      {open && (
        <div
          id="search-suggestions"
          role="listbox"
          className={cn(
            'absolute z-[120] mt-2 max-h-[70vh] overflow-y-auto border border-border bg-popover shadow-xl',
            variant === 'desktop' ? 'right-0 w-[22rem]' : 'left-0 right-0 w-full',
          )}
        >
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-gold" />
            </div>
          )}

          {/* Suggestions, before anything is typed */}
          {!loading && showSuggestions && (
            <div className="p-3">
              {recent.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      <Clock className="size-3" />
                      {t('search.recent')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        clearRecentSearches()
                        setRecent([])
                      }}
                      className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 transition hover:text-foreground"
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
                    <TrendingUp className="size-3" />
                    {t('search.popular')}
                  </span>
                  <TermList terms={popular} onPick={choose} />
                </div>
              )}

              {recent.length === 0 && popular.length === 0 && (
                <p className="py-4 text-center text-[12px] font-light text-muted-foreground">
                  {t('search.hint')}
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
                {results.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/product/${encodeURIComponent(p.id)}`}
                      onClick={close}
                      className="flex items-center gap-3 border-b border-border/40 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-accent/40"
                    >
                      <span className="relative size-11 shrink-0 overflow-hidden border border-border/60">
                        <Image
                          src={p.image}
                          alt=""
                          fill
                          sizes="44px"
                          className="object-cover"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-light text-foreground">
                          {localize(p.name)}
                        </span>
                        <span className="block text-[11px] text-muted-foreground/70">
                          {formatPrice(p.price)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Nothing found — never a dead end */}
          {showEmptyState && (
            <div className="flex flex-col items-center gap-3 px-4 py-7 text-center">
              <SearchX className="size-6 text-muted-foreground/30" strokeWidth={1.25} />
              <p className="text-[12px] font-light text-muted-foreground">
                {t('search.noResults')}
              </p>
              {popular.length > 0 && (
                <div className="w-full">
                  <span className="mb-1.5 block text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">
                    {t('search.tryInstead')}
                  </span>
                  <TermList terms={popular} onPick={choose} />
                </div>
              )}
              <Link
                href="/#shop"
                onClick={close}
                className="mt-1 border border-gold/40 bg-gold/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
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
