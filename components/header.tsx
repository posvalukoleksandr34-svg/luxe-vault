'use client'

import { Link } from '@/components/locale-link'
import { LifeBuoy, Search, ShoppingBag } from 'lucide-react'
import { AccountMenu } from '@/components/account/account-menu'
import { SearchBox } from '@/components/search-box'
import { useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/notification-center'
import { LocaleCurrencyMenu } from '@/components/locale-currency-menu'
import { MenuIcon } from '@/components/menu-icon'
import { setSiteMenuOpen, useSiteMenuOpen } from '@/lib/site-menu'
import { useStore } from '@/lib/store'

export function Header() {
  const { cartCount, setPanel, t, openSupport, supportUnread } = useStore()
  const menuOpen = useSiteMenuOpen()

  /**
   * Has the page scrolled off the top?
   *
   * At rest the bar is nearly transparent, so the hero runs edge to edge and
   * the wordmark is not sitting under a grey strip. Once content passes
   * beneath it, the ground becomes solid with a neutral hairline — the bar
   * becomes a surface only when it has something to separate.
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

  return (
    <header
      data-scrolled={scrolled}
      className="site-header sticky top-0 z-50 border-b"
    >
      {/* Three columns: the menu, the wordmark, the customer's own controls.
          The outer two are `minmax(0, 1fr)` each, so they are always exactly
          as wide as each other and the wordmark sits at the exact centre of
          the bar whatever either side holds — a signed-in bell, a cart badge,
          a longer language label.

          The right-hand row has to clear the wordmark down to a 320px phone,
          signed in: below md the cart and profile are left out of it — the
          bottom tab bar (components/bottom-nav.tsx, phones only) carries
          both, badges included — below lg the language and
          currency switcher is in the menu's top row, and below xl so is the
          support button (in the menu's list).

          overflow-x: clip — the icons' invisible 44px tap areas (.tap-safe)
          reach past the last icon, and at the screen edge that alone widened
          the page by a few pixels. `clip`, not `hidden`: it cuts one axis
          only and makes no scroll container, so the menus that open below
          the row are untouched. */}
      <div className="mx-auto grid h-16 max-w-[1400px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 overflow-x-clip px-4 sm:gap-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setSiteMenuOpen(!menuOpen)}
            className="tap-safe relative flex h-9 shrink-0 items-center gap-3 text-foreground transition-opacity hover:opacity-70"
            aria-label={menuOpen ? t('nav.closeMenu') : t('nav.menu')}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            aria-haspopup="dialog"
          >
            <MenuIcon open={menuOpen} />
            {/* The word as well from lg up, where there is room for it. */}
            <span aria-hidden className="t-label hidden lg:inline">
              {t('nav.menu')}
            </span>
            {/* A reply from the team is waiting: below xl the support button
                lives in the menu, so the menu button carries the dot. */}
            {!menuOpen && supportUnread > 0 && (
              <span className="absolute -right-1.5 top-1 size-1.5 rounded-full bg-gold xl:hidden" aria-hidden />
            )}
          </button>
        </div>

        {/* A Link, not a scroll-to-top button.
            The header is global, so on /product/[slug], /checkout, /order/[id]
            and the legal pages the old handler scrolled a page the visitor was
            already at the top of and went nowhere — the wordmark looked dead.
            An <a href="/"> also gets middle-click, "open in new tab", keyboard
            focus and crawlable internal linking, none of which a button has.

            Optically centred too: letter-spacing is added AFTER every letter,
            the last one included, so a tracked word sits half a space left of
            its box's centre. The last word gives that space back
            (margin-right: -tracking), with the tracking held in --track so the
            two always match at each size. */}
        <Link
          href="/"
          aria-label="LUXE VAULT — home"
          className="tap-safe flex select-none items-baseline gap-[0.2em] justify-self-center whitespace-nowrap font-serif text-base font-bold tracking-[var(--track)] text-foreground [--track:0.08em] min-[380px]:text-lg min-[380px]:[--track:0.14em] sm:text-xl sm:[--track:0.24em] lg:text-[22px] lg:[--track:0.28em]"
        >
          <span>LUXE</span>
          {/* VAULT in the accent, as in the footer. */}
          <span className="mr-[calc(var(--track)*-1)] text-gold">VAULT</span>
        </Link>

        <div className="flex min-w-0 items-center justify-end gap-0.5 sm:gap-2">
          {/* Search, at every width: it opens the search row under the bar.
              (An inline field here would grow toward the wordmark on focus.) */}
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className="tap-safe flex size-8 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground sm:size-9"
            aria-label="Search"
            aria-expanded={searchOpen}
          >
            <Search className="size-[18px]" />
          </button>

          {/* Language and currency — "IT · CHF". From lg up; below it, in
              the menu. */}
          <div className="hidden lg:block">
            <LocaleCurrencyMenu />
          </div>

          {/* Renders nothing for signed-out visitors, so the header keeps its
              shape rather than showing a bell that could only ever be empty. */}
          <NotificationCenter />

          {/* Support messages, on every page. The count is replies from the
              team the customer has not read yet. From xl up — below it the
              row is full, so there it lives in the menu (with a dot on the
              menu button when a reply is waiting). */}
          <button
            type="button"
            // The support centre's own front page — the topics, then the
            // request form for whoever needs it. The bot is the other entry
            // point, on the floating button to the left.
            onClick={() => openSupport()}
            className="tap-safe relative hidden size-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground xl:flex"
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
              Desktop only, like the cart below: on a phone the bottom tab
              bar's Profile tab is the way in. */}
          <div className="hidden md:contents">
            <AccountMenu />
          </div>

          <button
            type="button"
            onClick={() => setPanel('cart')}
            // Desktop only: on a phone the bottom tab bar's Cart tab, with
            // the same badge, is the way in.
            className="tap-safe relative hidden size-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground md:flex"
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
        <div className="animate-fade-in border-t border-border px-4 py-3">
          <div className="mx-auto w-full max-w-xl">
            <SearchBox variant="mobile" autoFocus onNavigate={() => setSearchOpen(false)} />
          </div>
        </div>
      )}
    </header>
  )
}
