'use client'

import { Link, useLocaleRouter } from '@/components/locale-link'
import { usePathname } from 'next/navigation'
import { Heart, LifeBuoy, Menu, Search, ShoppingBag, X } from 'lucide-react'
import { AccountMenu } from '@/components/account/account-menu'
import { SearchBox } from '@/components/search-box'
import { useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/notification-center'
import { LocaleCurrencyMenu } from '@/components/locale-currency-menu'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

const PRIMARY_NAV = [
  { href: '/catalog', label: 'nav.shop' },
  { href: '/about', label: 'nav.about' },
  { href: '/shipping', label: 'footer.shipping' },
  { href: '/legal/refunds', label: 'nav.returns' },
  { href: '/contact', label: 'nav.contact' },
] as const

const MOBILE_ITEM =
  'flex min-h-[48px] items-center px-3 text-left text-[15px] font-light tracking-wide text-foreground/85 transition-colors hover:text-foreground aria-[current=page]:text-gold'

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
    wishlistCount,
  } = useStore()

  const router = useLocaleRouter()
  const pathname = usePathname()

  const [mobileOpen, setMobileOpen] = useState(false)
  // Escape closes the phone menu (a disclosure, not a dialog), and focus goes
  // back to its button.
  useEffect(() => {
    if (!mobileOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setMobileOpen(false)
      document.querySelector<HTMLButtonElement>('[aria-controls="mobile-menu"]')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

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


  /** The current page, for aria-current: the bare path, language prefix
   *  stripped (/it/shipping is the Shipping page). */
  const barePath = pathname.replace(/^\/(it|fr|de)(?=\/|$)/, '') || '/'
  const isCurrent = (href: string) => barePath === href || barePath.startsWith(`${href}/`)

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
      {/* On a phone the row did not fit: menu, wordmark and five controls
          came to ~372px (414px signed in, with the bell), so the page
          scrolled sideways on 360–390px screens, the checkout included. Below
          md the cart and profile icons are left out, exactly as the wishlist
          already was — the bottom tab bar (components/bottom-nav.tsx, phones
          only) carries all three, badges included — and below 380px the gaps
          and the wordmark tighten as well.

          overflow-x: clip — the icons' invisible 44px tap areas (.tap-safe)
          reach past the last icon, and at the screen edge that alone widened
          the page by a few pixels. `clip`, not `hidden`: it cuts one axis
          only and makes no scroll container, so the menus that open below
          the row are untouched. */}
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-2 overflow-x-clip px-4 min-[380px]:gap-4 sm:px-6 lg:px-10">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="tap-safe relative lg:hidden text-muted-foreground transition hover:text-foreground"
          aria-label={t('nav.menu')}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
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
          <span className="font-serif text-base font-bold tracking-[0.06em] text-foreground min-[380px]:text-lg min-[380px]:tracking-[0.1em] sm:text-xl sm:tracking-[0.22em]">
            LUXE
          </span>
          <span className="font-serif text-base font-bold tracking-[0.06em] text-gold min-[380px]:text-lg min-[380px]:tracking-[0.1em] sm:text-xl sm:tracking-[0.22em]">
            VAULT
          </span>
        </Link>

        {/* Quiet links, generous spacing: the space between them does the
            separating, not ornament. */}
        {/* The five things a first-time customer looks for, as real links:
            the shop, who runs it, how delivery and returns work, and how to
            reach a person. */}
        <nav aria-label="Main" className="ml-10 hidden items-center gap-7 xl:ml-12 xl:gap-8 lg:flex">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href) ? 'page' : undefined}
              className="nav-link t-label"
            >
              {t(item.label)}
            </Link>
          ))}
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
            // The support centre's own front page — the topics, then the
            // request form for whoever needs it. The bot is the other entry
            // point, on the floating button to the left.
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

          {/* Signed in: the account menu. Signed out: the drawer's sign-in.
              Desktop only, like the wishlist below: on a phone the bottom tab
              bar's Profile tab is the way in. */}
          <div className="hidden md:contents">
            <AccountMenu />
          </div>

          {/* Saved items. A real link, not a drawer: the wishlist is a page
              with its own address, which is also what the bottom bar's tab
              points at.

              `hidden md:flex` complements that bar exactly — it is `md:hidden`,
              so a phone gets the tab and a desktop gets this, and no screen
              ever shows both routes to the same page. */}
          <Link
            href="/wishlist"
            className="tap-safe relative hidden size-9 items-center justify-center text-muted-foreground transition hover:text-foreground md:flex"
            aria-label={
              wishlistCount > 0 ? `${t('wishlist.title')} (${wishlistCount})` : t('wishlist.title')
            }
          >
            <Heart className="size-[18px]" />
            {wishlistCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold tabular-nums text-gold-foreground">
                {/* lib/wishlist.ts caps the list at 200, so three digits is
                    reachable by design and would burst a size-4 circle. Same
                    treatment as the bottom bar's badge. */}
                {wishlistCount > 99 ? '99+' : wishlistCount}
              </span>
            )}
          </Link>

          <button
            type="button"
            onClick={() => setPanel('cart')}
            // Desktop only, like the wishlist: on a phone the bottom tab bar's
            // Cart tab, with the same badge, is the way in.
            className="tap-safe relative hidden size-9 items-center justify-center text-muted-foreground transition hover:text-foreground md:flex"
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
        <div id="mobile-menu" className="animate-fade-in border-t border-border lg:hidden">
          <nav aria-label="Main" className="flex flex-col divide-y divide-border/40 px-4 py-2">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-current={isCurrent(item.href) ? 'page' : undefined}
                className={MOBILE_ITEM}
              >
                {t(item.label)}
              </Link>
            ))}
            <button onClick={goNew} className={MOBILE_ITEM}>
              {t('nav.newIn')}
            </button>
            <button onClick={goSale} className={MOBILE_ITEM}>
              {t('filter.sale')}
            </button>
            <Link href="/stylist" onClick={() => setMobileOpen(false)} className={MOBILE_ITEM}>
              {t('stylist.cta')}
            </Link>
            <Link href="/faq" onClick={() => setMobileOpen(false)} className={MOBILE_ITEM}>
              {t('footer.faq')}
            </Link>
            <button
              onClick={() => {
                setMobileOpen(false)
                openSupport()
              }}
              className={cn(MOBILE_ITEM, 'justify-between sm:hidden')}
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
