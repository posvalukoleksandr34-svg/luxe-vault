'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LifeBuoy, Menu, Search, ShoppingBag, X } from 'lucide-react'
import { AccountMenu } from '@/components/account/account-menu'
import { SearchBox } from '@/components/search-box'
import { useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/notification-center'
import { LocaleCurrencyMenu } from '@/components/locale-currency-menu'
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
    query,
    setQuery,
    setFilter,
    filter,
    openSupport,
    supportUnread,
  } = useStore()

  const router = useRouter()
  const pathname = usePathname()

  const [mobileOpen, setMobileOpen] = useState(false)

  /**
   * Has the page scrolled off the top?
   *
   * At rest the bar is nearly transparent, so the hero runs edge to edge and
   * the wordmark is not sitting under a grey strip. Once content passes
   * beneath it, the ground becomes solid charcoal with a neutral hairline —
   * the bar becomes a surface only when it has something to separate.
   *
   * A boolean, not a scroll position: the listener writes state at most twice
   * per page, when the threshold is crossed in either direction.
   */
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 24)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const [searchOpen, setSearchOpen] = useState(false)


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

  /**
   * New and Sale are views of the CATALOGUE now that the homepage carries no
   * grid. The filter is set first — it is store state the grid reads on
   * arrival — and the query string says the same thing, so the link also
   * works when pasted, shared or opened in a new tab.
   */
  function goView(view: 'new' | 'sale') {
    setFilter({ ...filter, sale: view === 'sale', group: null, category: null })
    setMobileOpen(false)
    router.push(`/catalog?view=${view}`)
  }

  const goSale = () => goView('sale')
  const goNew = () => goView('new')

  return (
    <header
      data-scrolled={scrolled}
      className="site-header sticky top-0 z-50 border-b"
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6 lg:px-10">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="tap-safe relative lg:hidden text-muted-foreground transition hover:text-foreground"
          aria-label="Menu"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          {!mobileOpen && supportUnread > 0 && (
            <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-gold sm:hidden" aria-hidden />
          )}
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
          className="tap-safe flex select-none items-baseline gap-0.5"
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

        {/* Quiet links, generous spacing: the space between them does the
            separating, not ornament. */}
        <nav className="ml-12 hidden items-center gap-8 lg:flex">
          {/* The stylist sits first in the nav: it is the entry point to the
              catalogue for someone who does not yet know what they want. A
              real Link, not a scroll handler, because it is its own route. */}
          <Link
            href="/stylist"
            className="nav-link t-label"
          >
            {t('stylist.cta')}
          </Link>
          <NavLink onClick={goCollections}>{t('nav.collections')}</NavLink>
          <NavLink onClick={goAbout}>{t('nav.about')}</NavLink>
          <NavLink onClick={goNew}>{t('filter.new')}</NavLink>
          <NavLink onClick={goReviews}>{t('reviews.title')}</NavLink>
          <NavLink onClick={goSale} accent>
            {t('filter.sale')}
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className="tap-safe flex size-8 items-center justify-center text-muted-foreground transition hover:text-foreground sm:size-9 sm:hidden"
            aria-label="Search"
          >
            <Search className="size-[18px]" />
          </button>

          <div className="hidden sm:block">
            <SearchBox variant="desktop" />
          </div>

          {/* Language and currency — "IT · CHF". */}
          <LocaleCurrencyMenu />

          {/* Renders nothing for signed-out visitors, so the header keeps its
              shape rather than showing a bell that could only ever be empty. */}
          <NotificationCenter />

          {/* Support messages, on every page. The count is replies from the
              team the customer has not read yet. From sm up — a phone's row
              is full, so there it lives in the menu (with a dot on the menu
              button when a reply is waiting). */}
          <button
            type="button"
            onClick={() => openSupport()}
            className="tap-safe relative hidden size-9 items-center justify-center text-muted-foreground transition hover:text-foreground sm:flex"
            aria-label={supportUnread > 0 ? `${t('support.title')} (${supportUnread})` : t('support.title')}
          >
            <LifeBuoy className="size-[18px]" />
            {supportUnread > 0 && (
              <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-gold text-[9px] font-bold text-gold-foreground">
                {supportUnread}
              </span>
            )}
          </button>

          {/* Signed in: the account menu. Signed out: the drawer's sign-in. */}
          <AccountMenu />

          <button
            type="button"
            onClick={() => setPanel('cart')}
            className="tap-safe relative flex size-8 items-center justify-center text-muted-foreground transition hover:text-foreground sm:size-9"
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
          <nav className="flex flex-col divide-y divide-border/40 px-4 py-2">
            <Link
              href="/stylist"
              onClick={() => setMobileOpen(false)}
              className="flex min-h-[44px] items-center px-3 text-left text-[15px] font-light tracking-wide text-foreground/80 transition-colors hover:text-foreground"
            >
              {t('stylist.cta')}
            </Link>
            <button onClick={goCollections} className="flex min-h-[44px] items-center px-3 text-left text-[15px] font-light tracking-wide text-foreground/80 transition-colors hover:text-foreground">
              {t('nav.collections')}
            </button>
            <button onClick={goAbout} className="flex min-h-[44px] items-center px-3 text-left text-[15px] font-light tracking-wide text-foreground/80 transition-colors hover:text-foreground">
              {t('nav.about')}
            </button>
            <button onClick={goNew} className="flex min-h-[44px] items-center px-3 text-left text-[15px] font-light tracking-wide text-foreground/80 transition-colors hover:text-foreground">
              {t('filter.new')}
            </button>
            <button onClick={goReviews} className="flex min-h-[44px] items-center px-3 text-left text-[15px] font-light tracking-wide text-foreground/80 transition-colors hover:text-foreground">
              {t('reviews.title')}
            </button>
            <button onClick={goSale} className="flex min-h-[44px] items-center px-3 text-left text-[15px] font-light tracking-wide text-gold/90 transition-colors hover:text-gold">
              {t('filter.sale')}
            </button>
            <button
              onClick={() => {
                setMobileOpen(false)
                openSupport()
              }}
              className="flex min-h-[44px] items-center justify-between px-3 text-left text-[15px] font-light tracking-wide text-foreground/80 transition-colors hover:text-foreground sm:hidden"
            >
              {t('support.title')}
              {supportUnread > 0 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-gold text-[9px] font-bold text-gold-foreground">
                  {supportUnread}
                </span>
              )}
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
 * The treatment lives in the `.nav-link` component class (app/globals.css):
 * neutral at rest, a gold hairline drawn in on hover, so the six items here
 * cannot drift apart. `accent` gives Распродажа the nav's one touch of gold —
 * the item that should pull the eye.
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
        'nav-link t-label',
        // Sale is the one nav item allowed its gold: warmer at rest, so it
        // reads as the priority without a different size or a badge.
        accent && 'text-gold/90 hover:text-gold',
      )}
    >
      {children}
    </button>
  )
}
