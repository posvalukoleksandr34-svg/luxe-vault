'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, type ComponentProps } from 'react'
import { hasLocalizedRoute, localizedPath } from '@/lib/locale-routing'
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

  const push = useCallback((href: string) => router.push(localeHref(href, locale)), [router, locale])
  const replace = useCallback(
    (href: string, options?: { scroll?: boolean }) => router.replace(localeHref(href, locale), options),
    [router, locale],
  )

  return { push, replace, back: router.back, refresh: router.refresh }
}

type LinkProps = ComponentProps<typeof NextLink>

export function Link({ href, ...props }: LinkProps) {
  const { locale } = useStore()
  // `href` may be a UrlObject; those are rare here and are passed through
  // rather than half-handled, which would be a silently wrong URL.
  const target = typeof href === 'string' ? localeHref(href, locale) : href
  return <NextLink href={target} {...props} />
}
