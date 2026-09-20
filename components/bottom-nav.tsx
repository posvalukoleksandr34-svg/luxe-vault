'use client'

import { Heart, Home, LayoutGrid, ShoppingBag, User, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The app-style tab bar, phones only (`md:hidden`). The desktop header already
 * carries the same destinations, and two navigations on one screen is one too
 * many.
 *
 * Two kinds of tab, because the site has two kinds of destination: Главная,
 * Каталог and Избранное are real routes and are real <a href>s — openable in a
 * new tab, followable by a crawler, and usable with the back button — while
 * Корзина and Профиль open the drawers the rest of the shop already uses, so
 * they are buttons. Nothing here duplicates state: the badge and the signed-in
 * check read the store.
 *
 * Sits above the page on `z-50` and inside the safe area, so the iPhone home
 * indicator never lands on a tab. The layout reserves the matching space
 * (app/layout.tsx), so nothing is ever hidden behind it.
 */

type Tab = {
  key: string
  labelKey: 'tab.home' | 'tab.catalog' | 'tab.wishlist' | 'tab.cart' | 'tab.profile'
  icon: LucideIcon
  href?: string
  /** True when this tab represents the page currently open. */
  active: (pathname: string) => boolean
}

const TABS: Tab[] = [
  { key: 'home', labelKey: 'tab.home', icon: Home, href: '/', active: (p) => p === '/' },
  { key: 'catalog', labelKey: 'tab.catalog', icon: LayoutGrid, href: '/#shop', active: (p) => p.startsWith('/category') },
  { key: 'wishlist', labelKey: 'tab.wishlist', icon: Heart, href: '/wishlist', active: (p) => p === '/wishlist' },
  { key: 'cart', labelKey: 'tab.cart', icon: ShoppingBag, active: () => false },
  { key: 'profile', labelKey: 'tab.profile', icon: User, active: (p) => p.startsWith('/account') },
]

export function BottomNav() {
  const { t, cartCount, wishlistCount, currentUser, panel, setPanel, openAuth, openAccount } = useStore()
  const pathname = usePathname() ?? '/'

  // The admin console is a different application with its own chrome.
  if (pathname.startsWith('/admin')) return null

  const itemClass = (on: boolean) =>
    cn(
      'no-juice relative flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-[10px] tracking-[0.06em] transition-colors duration-200',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-gold',
      on ? 'text-gold' : 'text-neutral-400 hover:text-neutral-100',
    )

  const badge = (count: number) =>
    count > 0 ? (
      <span className="absolute right-[18%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold tabular-nums text-gold-foreground">
        {count > 99 ? '99+' : count}
      </span>
    ) : null

  return (
    <nav
      aria-label={t('tab.nav')}
      className="hide-with-keyboard fixed inset-x-0 bottom-0 z-50 block border-t border-white/10 bg-black/90 backdrop-blur-md md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid h-16 grid-cols-5">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const label = t(tab.labelKey)

          if (tab.key === 'cart') {
            const on = panel === 'cart'
            return (
              <li key={tab.key} className="contents">
                <button type="button" onClick={() => setPanel('cart')} aria-label={label} className={itemClass(on)}>
                  <Icon aria-hidden strokeWidth={1.5} className="size-[21px]" />
                  {badge(cartCount)}
                  <span>{label}</span>
                </button>
              </li>
            )
          }

          if (tab.key === 'profile') {
            const on = panel === 'user' || tab.active(pathname)
            return (
              <li key={tab.key} className="contents">
                <button
                  type="button"
                  onClick={() => (currentUser ? openAccount() : openAuth('login'))}
                  aria-label={label}
                  className={itemClass(on)}
                >
                  <Icon aria-hidden strokeWidth={1.5} className="size-[21px]" />
                  <span>{label}</span>
                </button>
              </li>
            )
          }

          const on = tab.active(pathname)
          return (
            <li key={tab.key} className="contents">
              <Link
                href={tab.href as string}
                aria-label={label}
                aria-current={on ? 'page' : undefined}
                className={itemClass(on)}
              >
                <Icon aria-hidden strokeWidth={1.5} className="size-[21px]" />
                {tab.key === 'wishlist' && badge(wishlistCount)}
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
