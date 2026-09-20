import { DEFAULT_LOCALE, STOREFRONT_LOCALES, isStorefrontLocale } from '@/lib/i18n'
import { SITE_ORIGIN } from '@/lib/seo'
import type { StorefrontLocale } from '@/lib/types'

/**
 * WHICH URL IS WHICH LANGUAGE.
 *
 * The storefront used to be one set of URLs whose language lived in
 * localStorage. A visitor could read it in Italian; a crawler never could,
 * because the HTML at every address was English and the switch only happened
 * after hydration. Italian was therefore unindexable, and `hreflang` could not
 * help — it names distinct URLs, and there were none.
 *
 * Now the language is part of the path, with the default left bare:
 *
 *     /            /catalog            /product/x      → English
 *     /it          /it/catalog         /it/product/x   → Italian
 *     /de …  /fr …                                      → German, French
 *
 * The default is UNPREFIXED rather than sitting at /en. Two URLs that serve
 * the same language are a duplicate, and /en would have to be redirected away
 * anyway; leaving English bare keeps the shop's existing addresses working
 * exactly as they did, which also means no inbound link ever breaks.
 *
 * Only the storefront is localised. The console, the API, checkout, the
 * account and the transactional pages (`UNLOCALIZED_SEGMENTS`) keep single
 * addresses: they are noindex or disallowed, so a second URL for them would be
 * cost without benefit.
 */

/** Every language with URLs of its own — the same set the switcher offers, so
 *  a visitor can never choose a language that has no address. */
export const INDEXED_LOCALES: StorefrontLocale[] = STOREFRONT_LOCALES.map((l) => l.code)

/**
 * Top-level segments that are NOT localised, and which middleware must leave
 * alone. Everything else under `/` is a storefront path and gets a language.
 *
 * Whole subtrees, deliberately: a segment that is localised at its root and
 * not at a child (a localised /stylist over a bare /stylist/share) would have
 * middleware rewrite the child into a route that does not exist, and the page
 * would 404 for no visible reason.
 */
export const UNLOCALIZED_SEGMENTS = [
  'admin',
  'api',
  'auth',
  'account',
  'cart',
  'checkout',
  'order',
  'success',
  'newsletter',
  // Next's own file-convention routes and assets.
  '_next',
  'icons',
  'fonts',
  'images',
]

/** The path prefix for a language: nothing for the default, `/xx` otherwise. */
export function localePrefix(locale: StorefrontLocale): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`
}

/**
 * Splits a request path into its language and the path underneath.
 *
 * A path with no language prefix is the default language, which is the whole
 * point of leaving English bare. An unknown first segment is a normal path —
 * `/catalog` is the catalogue, not a language called "catalog".
 */
export function splitLocale(pathname: string): { locale: StorefrontLocale; path: string } {
  const [, first = '', ...rest] = pathname.split('/')
  if (isStorefrontLocale(first) && first !== DEFAULT_LOCALE) {
    return { locale: first, path: `/${rest.join('/')}` }
  }
  return { locale: DEFAULT_LOCALE, path: pathname }
}

/** True when this path belongs to a part of the site that has no language. */
export function isUnlocalizedPath(pathname: string): boolean {
  const first = pathname.split('/')[1] ?? ''
  return UNLOCALIZED_SEGMENTS.indexOf(first) !== -1
}

/**
 * The same page in another language.
 *
 * `path` is always the bare, unprefixed path — what the route file is called.
 * Passing an already-prefixed path would produce `/it/it/catalog`, so callers
 * hold bare paths and localise them at the edge, which is also what keeps the
 * language switcher able to stay on the current page.
 */
export function localizedPath(path: string, locale: StorefrontLocale): string {
  const clean = path === '/' ? '' : path
  return `${localePrefix(locale)}${clean}` || '/'
}

/**
 * `alternates` for a page's metadata: its canonical, and every language's
 * version of it.
 *
 * Both halves matter and they say different things. The canonical says "this
 * URL is the original" — without it the four language versions look like four
 * copies of one page and Google picks one, usually not the one you wanted.
 * `languages` says "these four are the same page in different languages", which
 * is what makes an Italian search show the Italian URL.
 *
 * `x-default` points at the bare path: the version served to a visitor whose
 * language the shop does not publish in.
 */
export function alternatesFor(path: string, locale: StorefrontLocale) {
  const languages: Record<string, string> = {}
  for (const code of INDEXED_LOCALES) {
    languages[code] = `${SITE_ORIGIN}${localizedPath(path, code)}`
  }
  languages['x-default'] = `${SITE_ORIGIN}${localizedPath(path, DEFAULT_LOCALE)}`

  return {
    canonical: `${SITE_ORIGIN}${localizedPath(path, locale)}`,
    languages,
  }
}

/** The `lang` attribute and `og:locale` value for a language. */
export const OG_LOCALE: Record<StorefrontLocale, string> = {
  en: 'en_US',
  it: 'it_IT',
  fr: 'fr_FR',
  de: 'de_DE',
}

/**
 * Narrows a `[locale]` route param.
 *
 * The default language is included: middleware rewrites the bare paths onto
 * it, so `/catalog` arrives here as `en`. What is rejected is anything else —
 * an unknown `[locale]` is a 404 rather than a quiet fallback to English,
 * because serving the catalogue at /xx/catalog for any xx would mint an
 * unbounded set of URLs that all duplicate one page.
 */
export function localeParam(value: string): StorefrontLocale | null {
  return isStorefrontLocale(value) ? value : null
}
