'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@/components/locale-link'
import { LocaleCurrencyMenu } from '@/components/locale-currency-menu'
import { MenuIcon } from '@/components/menu-icon'
import { closeSiteMenu, useSiteMenuOpen } from '@/lib/site-menu'
import { useStore } from '@/lib/store'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { cn } from '@/lib/utils'

/**
 * The site menu: a panel that slides in from the left over a dimmed page,
 * opened by the menu button in the header (components/header.tsx).
 *
 * Everything in it already existed — the header's links, the phone menu's
 * New in / Sale / Support, and the departments with their
 * categories from the live taxonomy (the same tree the catalogue sidebar
 * reads). Nothing here is a new destination.
 *
 * A department with categories opens its own level, sliding in from the
 * right, with "View all" for the department page and Back to return; one
 * without goes straight to its page.
 *
 * Mounted once in the root layout (components/global-panels.tsx) and portalled
 * to <body>: the header's backdrop-filter makes it the containing block of
 * any fixed-position descendant, so inside the header the panel would be laid
 * out against the 64px bar, not the window. Motion lives in app/globals.css
 * (.site-menu), where the site's "reduce animations" switch and the system
 * setting collapse it to an instant change.
 */

/** The language prefix off a pathname: /it/shipping is the Shipping page. */
const barePath = (path: string) => path.replace(/^\/(it|fr|de)(?=\/|$)/, '') || '/'

type Department = { slug: string; label: string; items: { slug: string; label: string }[] }

export function SiteMenu() {
  const { t, localize, categoryTree, groupLabels, categoryLabels, filter, setFilter, openSupport, supportUnread } =
    useStore()
  const open = useSiteMenuOpen()
  const pathname = usePathname()

  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({})

  // `shown` trails `open` by a frame on the way in, so the panel is first
  // painted closed and the entrance transitions from there — the very first
  // open included, when this component has only just mounted.
  const [shown, setShown] = useState(false)
  // The department whose level is on screen, and the one whose level is
  // RENDERED: the second outlives the first while Back slides it away.
  const [subOpen, setSubOpen] = useState(false)
  const [subSlug, setSubSlug] = useState<string | null>(null)
  // Where the visitor is, read when the menu opens: marks the current page.
  const [here, setHere] = useState('')

  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    setHere(barePath(window.location.pathname) + window.location.search)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [open])

  // A navigation closes it — from a link in it, or from anywhere else (the
  // browser's back button). Not on mount: this mounts on the first open.
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    closeSiteMenu()
  }, [pathname])

  // Escape closes the whole menu, from either level — unless a popover in
  // it is open (the language menu), which Escape closes first.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (panelRef.current?.querySelector('[role="dialog"]')) return
      e.preventDefault()
      closeSiteMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // The page behind stays where it is. On <html>, which is the scroller here;
  // its `scrollbar-gutter: stable` keeps the gutter, so nothing shifts.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previous
    }
  }, [open])

  // Tab stays inside the panel; closing returns focus to the menu button.
  // Declared before the effect that moves focus in, so it records the button
  // as the opener first.
  useFocusTrap(panelRef, shown)
  useEffect(() => {
    if (shown) closeRef.current?.focus({ preventScroll: true })
  }, [shown])

  // Into a level, focus goes to its Back button; back out, to the department
  // that opened it.
  const subMoved = useRef(false)
  useEffect(() => {
    if (!shown || !subMoved.current) return
    if (subOpen) backRef.current?.focus({ preventScroll: true })
    else if (subSlug) triggers.current[subSlug]?.focus({ preventScroll: true })
  }, [subOpen, shown, subSlug])

  // A closed menu reopens at the top level. Reset once it is out of sight,
  // so the levels do not visibly slide back while the panel leaves.
  useEffect(() => {
    if (open) return
    const id = setTimeout(() => {
      subMoved.current = false
      setSubOpen(false)
      setSubSlug(null)
    }, 480)
    return () => clearTimeout(id)
  }, [open])

  const departments = useMemo<Department[]>(
    () =>
      categoryTree.map((node) => ({
        slug: node.group,
        label: localize(groupLabels[node.group] ?? {}) || node.group,
        items: node.items.map((slug) => ({ slug, label: localize(categoryLabels[slug] ?? {}) || slug })),
      })),
    [categoryTree, groupLabels, categoryLabels, localize],
  )
  const sub = departments.find((d) => d.slug === subSlug) ?? null

  function enter(slug: string) {
    subMoved.current = true
    setSubSlug(slug)
    setSubOpen(true)
  }
  function back() {
    subMoved.current = true
    setSubOpen(false)
  }

  /** The current page: path and query must both match for the catalogue's
   *  views (/catalog?view=new is not /catalog), the path alone elsewhere. */
  function isCurrent(href: string) {
    if (href.includes('?')) return here === href
    const [path, query = ''] = here.split('?')
    return path === href && !/(^|&)view=/.test(query)
  }
  const inDepartment = (slug: string) => {
    const path = here.split('?')[0]
    return path === `/category/${slug}` || path.startsWith(`/category/${slug}/`)
  }

  /**
   * New and Sale are views of the CATALOGUE. The filter is set first — it is
   * store state the grid reads on arrival — and the query string says the
   * same thing, so the link also works when pasted, shared or opened in a new
   * tab.
   */
  const view = (v: 'new' | 'sale') => () => setFilter({ ...filter, sale: v === 'sale', group: null, category: null })

  // Staggered in on open, in reading order.
  let order = 0
  const nextIndex = () => order++

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      id="site-menu"
      className="site-menu"
      data-state={shown ? 'open' : 'closed'}
      data-sub={subOpen}
    >
      {/* Covers the page while the menu is open: a click on it closes the
          menu and goes no further. */}
      <div className="site-menu__overlay" onClick={closeSiteMenu} aria-hidden />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.menu')}
        tabIndex={-1}
        inert={!shown}
        className="site-menu__panel"
      >
        {/* The same row as the header's: on a phone, where the panel covers
            the bar, the close button sits exactly where the menu button was,
            the wordmark stays in the centre, and the language and currency
            switcher — in the header only from lg up — is where it would be. */}
        <div className="site-menu__top">
          <button
            ref={closeRef}
            type="button"
            onClick={closeSiteMenu}
            className="site-menu__close tap-safe"
            aria-label={t('nav.closeMenu')}
          >
            <MenuIcon open={shown} />
          </button>
          <Link
            href="/"
            onClick={closeSiteMenu}
            aria-label="LUXE VAULT — home"
            className="site-menu__brand font-serif font-bold"
          >
            <span>LUXE</span>
            <span className="text-gold">VAULT</span>
          </Link>
          <div className="site-menu__tools lg:hidden">
            <LocaleCurrencyMenu />
          </div>
        </div>

        <div className="site-menu__levels">
          <nav aria-label={t('nav.menu')} className="site-menu__level" data-level="root" inert={subOpen}>
            <ul className="site-menu__list">
              <Item index={nextIndex()}>
                <MenuLink
                  href="/catalog?view=new"
                  current={isCurrent('/catalog?view=new')}
                  onClick={view('new')}
                >
                  {t('footer.new')}
                </MenuLink>
              </Item>

              {departments.map((d) => (
                <Item key={d.slug} index={nextIndex()}>
                  {d.items.length > 0 ? (
                    <button
                      ref={(el) => {
                        triggers.current[d.slug] = el
                      }}
                      type="button"
                      onClick={() => enter(d.slug)}
                      className="site-menu__link"
                      aria-current={inDepartment(d.slug) ? 'true' : undefined}
                    >
                      <span className="site-menu__label">{d.label}</span>
                      <ChevronRight aria-hidden className="site-menu__chevron" strokeWidth={1.25} />
                    </button>
                  ) : (
                    <MenuLink href={`/category/${d.slug}`} current={isCurrent(`/category/${d.slug}`)}>
                      {d.label}
                    </MenuLink>
                  )}
                </Item>
              ))}

              <Item index={nextIndex()}>
                <MenuLink href="/catalog" current={isCurrent('/catalog')}>
                  {t('footer.allProducts')}
                </MenuLink>
              </Item>
              <Item index={nextIndex()}>
                <MenuLink
                  href="/catalog?view=sale"
                  current={isCurrent('/catalog?view=sale')}
                  onClick={view('sale')}
                >
                  {t('footer.sale')}
                </MenuLink>
              </Item>
            </ul>

            <Item index={nextIndex()} as="p" className="site-menu__eyebrow">
              {t('footer.customerCare')}
            </Item>
            <ul className="site-menu__list site-menu__list--secondary">
              {(
                [
                  ['/shipping', 'footer.shipping'],
                  ['/legal/refunds', 'nav.returns'],
                  ['/faq', 'nav.faq'],
                  ['/about', 'nav.about'],
                  ['/contact', 'nav.contact'],
                ] as const
              ).map(([href, label]) => (
                <Item key={href} index={nextIndex()}>
                  <MenuLink href={href} current={isCurrent(href)} secondary>
                    {t(label)}
                  </MenuLink>
                </Item>
              ))}
              <Item index={nextIndex()}>
                <button
                  type="button"
                  onClick={() => {
                    closeSiteMenu()
                    openSupport()
                  }}
                  className="site-menu__link site-menu__link--secondary"
                >
                  <span className="site-menu__label">{t('support.title')}</span>
                  {supportUnread > 0 && <span className="site-menu__count">{supportUnread}</span>}
                </button>
              </Item>
            </ul>
          </nav>

          {sub && (
            <div className="site-menu__level" data-level="sub" inert={!subOpen}>
              <button ref={backRef} type="button" onClick={back} className="site-menu__back">
                <ChevronLeft aria-hidden className="size-4" strokeWidth={1.25} />
                {t('common.back')}
              </button>
              <nav aria-label={sub.label}>
                <p className="site-menu__title">{sub.label}</p>
                <ul className="site-menu__list">
                  <SubItem index={0}>
                    <MenuLink href={`/category/${sub.slug}`} current={isCurrent(`/category/${sub.slug}`)}>
                      {t('nav.viewAll')}
                    </MenuLink>
                  </SubItem>
                  {sub.items.map((c, n) => (
                    <SubItem key={c.slug} index={n + 1}>
                      <MenuLink
                        href={`/category/${sub.slug}/${c.slug}`}
                        current={isCurrent(`/category/${sub.slug}/${c.slug}`)}
                      >
                        {c.label}
                      </MenuLink>
                    </SubItem>
                  ))}
                </ul>
              </nav>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Item({
  index,
  children,
  as: Tag = 'li',
  className,
}: {
  index: number
  children: ReactNode
  as?: 'li' | 'p'
  className?: string
}) {
  return (
    <Tag className={cn('site-menu__item', className)} style={{ '--i': index } as CSSProperties}>
      {children}
    </Tag>
  )
}

function SubItem({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="site-menu__item site-menu__item--sub" style={{ '--i': index } as CSSProperties}>
      {children}
    </li>
  )
}

/** A destination: closes the menu as it navigates (the panel slides out
 *  while the next page renders). */
function MenuLink({
  href,
  current,
  secondary,
  onClick,
  children,
}: {
  href: string
  current: boolean
  secondary?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={() => {
        onClick?.()
        closeSiteMenu()
      }}
      aria-current={current ? 'page' : undefined}
      className={secondary ? 'site-menu__link site-menu__link--secondary' : 'site-menu__link'}
    >
      <span className="site-menu__label">{children}</span>
    </Link>
  )
}
