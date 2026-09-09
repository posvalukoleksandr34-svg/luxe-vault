'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import { SearchBox } from '@/components/search-box'
import { useState } from 'react'
import { NotificationCenter } from '@/components/notification-center'
import { LOCALES } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

function scrollToId(id: string): boolean {
  const el = document.getElementById(id)
  if (!el) return false
  const top = el.getBoundingClientRect().top + window.scrollY - 72
  window.scrollTo({ top, behavior: 'smooth' })
  return true
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
    openAccount,
  } = useStore()

  const router = useRouter()
  const pathname = usePathname()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const currentLang = LOCALES.find((l) => l.code === locale)

  /**
   * These target sections of the homepage. Now that the catalogue has its own
   * routes, the header is often rendered somewhere those sections do not
   * exist — on /category/shoes, `scrollToId('about')` found nothing and the
   * link did nothing at all. Falling back to a real navigation makes every
   * header link work from every page.
   */
  function goSection(id: string) {
    setMobileOpen(false)
    if (pathname === '/' && scrollToId(id)) return
    router.push(`/#${id}`)
  }

  const goCollections = () => goSection('collections')
  const goAbout = () => goSection('about')
  const goReviews = () => goSection('reviews')

  function goSale() {
    setFilter({ ...filter, sale: true, group: null, category: null })
    // The filter is store state the homepage grid reads, so the scroll (or the
    // navigation) has to happen after it is set either way.
    setTimeout(() => goSection('shop'), 100)
  }

  function goNew() {
    setFilter({ ...filter, sale: false, group: null, category: null })
    setTimeout(() => goSection('shop'), 100)
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

        {/* A Link, not a scroll-to-top button.
            The header is global, so on /product/[slug], /checkout, /order/[id]
            and the legal pages the old handler scrolled a page the visitor was
            already at the top of and went nowhere — the wordmark looked dead.
            An <a href="/"> also gets middle-click, "open in new tab", keyboard
            focus and crawlable internal linking, none of which a button has. */}
        <Link
          href="/"
          aria-label="LUXE VAULT — home"
          className="flex select-none items-baseline gap-0.5"
        >
          {/* Tighter below sm. The action bar gained a sixth control and the
              row overflowed by ~35px on a 375px screen, which scrolled the
              whole PAGE sideways — the wordmark's 0.22em tracking was the
              cheapest 40px to reclaim, and shrinking it costs less than
              hiding a control the customer came to use. */}
          <span className="font-serif text-lg font-bold tracking-[0.1em] text-foreground sm:text-xl sm:tracking-[0.22em]">
            LUXE
          </span>
          <span className="font-serif text-lg font-bold tracking-[0.1em] text-gold sm:text-xl sm:tracking-[0.22em]">
            VAULT
          </span>
        </Link>

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

          <div className="hidden sm:block">
            <SearchBox variant="desktop" />
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

          {/* Renders nothing for signed-out visitors, so the header keeps its
              shape rather than showing a bell that could only ever be empty. */}
          <NotificationCenter />

          <button
            type="button"
            onClick={() => openAccount('orders')}
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
          <SearchBox variant="mobile" onNavigate={() => setSearchOpen(false)} />
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
