'use client'

import { Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import { useState } from 'react'
import { LOCALES } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (el) {
    const top = el.getBoundingClientRect().top + window.scrollY - 72
    window.scrollTo({ top, behavior: 'smooth' })
  }
}

export function Header() {
  const {
    cartCount,
    setPanel,
    t,
    locale,
    setLocale,
    query,
    setQuery,
    currentUser,
    setFilter,
    filter,
  } = useStore()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const currentLang = LOCALES.find((l) => l.code === locale)

  function goCollections() {
    setMobileOpen(false)
    scrollToId('collections')
  }

  function goAbout() {
    setMobileOpen(false)
    scrollToId('about')
  }

  function goReviews() {
    setMobileOpen(false)
    scrollToId('reviews')
  }

  function goSale() {
    setMobileOpen(false)
    setFilter({ ...filter, sale: true, group: null, category: null })
    setTimeout(() => scrollToId('shop'), 100)
  }

  function goNew() {
    setMobileOpen(false)
    setFilter({ ...filter, sale: false, group: null, category: null })
    setTimeout(() => scrollToId('shop'), 100)
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border glass">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6 lg:px-10">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="lg:hidden text-muted-foreground transition hover:text-foreground"
          aria-label="Menu"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-baseline gap-0.5 select-none"
        >
          <span className="font-serif text-xl font-bold tracking-[0.22em] text-foreground">
            LUXE
          </span>
          <span className="font-serif text-xl font-bold tracking-[0.22em] text-gold">
            VAULT
          </span>
        </button>

        {/* gap-8 -> gap-9: hover scales each item 5%, and at the old spacing
            an enlarged item nearly touched its neighbour. */}
        <nav className="ml-10 hidden items-center gap-9 lg:flex">
          <NavLink onClick={goCollections}>{t('nav.collections')}</NavLink>
          <NavLink onClick={goAbout}>{t('nav.about')}</NavLink>
          <NavLink onClick={goNew}>{t('filter.new')}</NavLink>
          <NavLink onClick={goReviews}>{t('reviews.title')}</NavLink>
          <NavLink onClick={goSale} accent>
            {t('filter.sale')}
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className="flex size-9 items-center justify-center text-muted-foreground transition hover:text-foreground sm:hidden"
            aria-label="Search"
          >
            <Search className="size-[18px]" />
          </button>

          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => scrollToId('shop')}
              placeholder={t('filter.search')}
              className="w-36 border border-transparent bg-transparent py-2 pl-9 pr-3 text-[13px] text-foreground outline-none transition-all duration-300 placeholder:text-muted-foreground/60 focus:w-52 focus:border-border"
            />
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setLangOpen((v) => !v)}
              className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground transition hover:text-foreground"
            >
              {currentLang?.flag}
            </button>
            {langOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} />
                <div className="animate-scale-in absolute right-0 top-full z-50 mt-2 w-36 border border-border bg-popover py-1.5 shadow-2xl">
                  {LOCALES.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => {
                        setLocale(l.code)
                        setLangOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition hover:bg-accent',
                        l.code === locale ? 'text-gold' : 'text-foreground',
                      )}
                    >
                      <span className="text-[10px] tracking-wider">{l.flag}</span>
                      {l.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setPanel('user')}
            className="relative flex size-9 items-center justify-center text-muted-foreground transition hover:text-foreground"
            aria-label={t('nav.profile')}
          >
            <User className="size-[18px]" />
            {currentUser && (
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-gold" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setPanel('cart')}
            className="relative flex size-9 items-center justify-center text-muted-foreground transition hover:text-foreground"
            aria-label={t('cart.title')}
          >
            <ShoppingBag className="size-[18px]" />
            {cartCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-gold text-[9px] font-bold text-gold-foreground">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="border-t border-border px-4 py-3 sm:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('filter.search')}
              className="w-full rounded-full border border-border bg-card/50 py-2.5 pl-9 pr-3 text-sm text-foreground outline-none focus:border-gold/30"
            />
          </div>
        </div>
      )}

      {mobileOpen && (
        <div className="animate-fade-in border-t border-border lg:hidden">
          <nav className="flex flex-col gap-0.5 px-4 py-3">
            <button onClick={goCollections} className="px-3 py-2.5 text-left text-sm text-[#c9a227] transition-all duration-300 hover:bg-accent hover:text-[#d4af37] hover:drop-shadow-[0_0_10px_rgba(212,175,55,0.45)]">
              {t('nav.collections')}
            </button>
            <button onClick={goAbout} className="px-3 py-2.5 text-left text-sm text-[#c9a227] transition-all duration-300 hover:bg-accent hover:text-[#d4af37] hover:drop-shadow-[0_0_10px_rgba(212,175,55,0.45)]">
              {t('nav.about')}
            </button>
            <button onClick={goNew} className="px-3 py-2.5 text-left text-sm text-[#c9a227] transition-all duration-300 hover:bg-accent hover:text-[#d4af37] hover:drop-shadow-[0_0_10px_rgba(212,175,55,0.45)]">
              {t('filter.new')}
            </button>
            <button onClick={goReviews} className="px-3 py-2.5 text-left text-sm text-[#c9a227] transition-all duration-300 hover:bg-accent hover:text-[#d4af37] hover:drop-shadow-[0_0_10px_rgba(212,175,55,0.45)]">
              {t('reviews.title')}
            </button>
            <button onClick={goSale} className="rounded-lg px-3 py-2.5 text-left text-sm text-gold transition hover:bg-accent">
              {t('filter.sale')}
            </button>
          </nav>
        </div>
      )}
    </header>
  )
}

/**
 * Desktop nav item.
 *
 * The gold/scale/glow treatment lives in the `.nav-gold` component class
 * (app/globals.css) so the six items here — and the mobile drawer — cannot
 * drift apart. `accent` brightens Распродажа a step above the rest, which is
 * the one item that should pull the eye.
 */
function NavLink({
  onClick,
  children,
  accent,
}: {
  onClick: () => void
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'nav-gold text-[11px] uppercase tracking-[0.15em]',
        // Slightly hotter at rest, so "Sale" reads as the priority item
        // without needing a different size or a badge.
        accent && 'text-[#e0bb4a]',
      )}
    >
      {children}
    </button>
  )
}
