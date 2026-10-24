'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, type ComponentProps } from 'react'
import { hasLocalizedRoute, localizedPath } from '@/lib/locale-routing'
import { noteNavigationTrigger, pageTransition } from '@/lib/page-transition'
import { useStore } from '@/lib/store'
import type { StorefrontLocale } from '@/lib/types'

/**
 * A <Link> that keeps the visitor in the language they are reading.
 *
 * Without it every link is a way out of Italian: a visitor on /it/catalog taps
 * a product and lands on the English /product/x, because the href in the
 * source is bare. That also strands the localised URLs as an island a crawler
 * only reaches through the sitemap, with no internal links pointing at them —
 * which is most of what tells a search engine a page matters.
 *
 * Storefront components import it in place of next/link, so their hrefs stay
 * bare and readable ("/catalog", not "/it/catalog") and the prefix is added in
 * one place. Everything else about it is next/link: props, prefetch, `as`.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH:
 *  - anything that is not an internal path — external URLs, mailto:, tel:, #x
 *  - paths with no localised route (checkout, the account, /order/…), which
 *    exist at one address only; prefixing those would produce a 404
 *  - the default language, which is served unprefixed
 * The query string and hash ride along untouched: only the path is prefixed,
 * so "/catalog?view=sale" becomes "/it/catalog?view=sale" rather than nonsense.
 */

/** Splits "/catalog?view=sale#top" into its path and the rest. */
function splitPath(href: string): [path: string, rest: string] {
  const cut = href.search(/[?#]/)
  return cut === -1 ? [href, ''] : [href.slice(0, cut), href.slice(cut)]
}

/**
 * The href a visitor reading `locale` should follow. Exported because the
 * imperative navigations (router.push) need exactly the same rule, and two
 * copies of it would drift.
 */
export function localeHref(href: string, locale: StorefrontLocale): string {
  // Only site-internal paths. "//evil.com" is protocol-relative and external,
  // which is why the second character is checked too.
  if (!href.startsWith('/') || href.startsWith('//')) return href
  const [path, rest] = splitPath(href)
  if (!hasLocalizedRoute(path)) return href
  return `${localizedPath(path, locale)}${rest}`
}

/** `router.push`/`replace` that keep the language, for the handful of
 *  navigations that are not links. */
export function useLocaleRouter() {
  const router = useRouter()
  const { locale } = useStore()

  // Imperative navigations (a search submitted, a checkout left) get the same
  // page transition as links. replace() does not: it rewrites the current
  // page's address (filters, tabs) rather than going somewhere new.
  const push = useCallback(
    (href: string) => {
      const target = localeHref(href, locale)
      pageTransition(target, () => router.push(target))
    },
    [router, locale],
  )
  const replace = useCallback(
    (href: string, options?: { scroll?: boolean }) => router.replace(localeHref(href, locale), options),
    [router, locale],
  )

  return { push, replace, back: router.back, refresh: router.refresh }
}

type LinkProps = ComponentProps<typeof NextLink>

/**
 * The storefront's link, and with it the site's page transitions
 * (lib/page-transition.ts). next/link still does everything it does — the
 * prefetch, the pending state, ignoring modifier-clicks and new tabs, leaving
 * external URLs and downloads to the browser — and calls `onNavigate` only
 * for a plain click on an internal address. That is the one moment the
 * navigation is handed to pageTransition(), which runs the same router call
 * (push or replace, with this link's scroll option) inside a view transition,
 * or runs it straight away when it cannot.
 *
 * Opting a link out: data-transition="off". A link whose own onClick or
 * onNavigate prevents navigation keeps that behaviour.
 */
export function Link({ href, onClick, onNavigate, replace, scroll, ...props }: LinkProps) {
  const { locale } = useStore()
  const router = useRouter()
  // `href` may be a UrlObject; those are rare here and are passed through
  // rather than half-handled, which would be a silently wrong URL.
  const target = typeof href === 'string' ? localeHref(href, locale) : href
  const optedOut = (props as Record<string, unknown>)['data-transition'] === 'off'
  return (
    <NextLink
      href={target}
      replace={replace}
      scroll={scroll}
      {...props}
      onClick={(e) => {
        noteNavigationTrigger(e.currentTarget)
        onClick?.(e)
      }}
      onNavigate={(e) => {
        let prevented = false
        onNavigate?.({
          preventDefault: () => {
            prevented = true
            e.preventDefault()
          },
        })
        if (prevented || optedOut || typeof target !== 'string') return
        e.preventDefault()
        const options = { scroll: scroll ?? true }
        pageTransition(target, () => (replace ? router.replace(target, options) : router.push(target, options)))
      }}
    />
  )
}
