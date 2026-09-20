import type { Metadata } from 'next'

import { DEFAULT_LOCALE } from '@/lib/i18n'
import { INDEXED_LOCALES } from '@/lib/locale-routing'
import { pageMetadata } from '@/lib/seo'
import type { StorefrontLocale } from '@/lib/types'

/**
 * Per-page metadata builders, shared by each storefront route and its
 * localised twin under app/[locale].
 *
 * They live here rather than beside their routes because Next allows a
 * page.tsx to export only its own conventional names — a second export from
 * one is a build error. One module for all of them also makes the set of
 * indexable pages readable in one place.
 */

/** The languages a localised route is prerendered for: every one with URLs,
 *  minus the default, which is served by the unprefixed route. */
export function localeStaticParams(): { locale: StorefrontLocale }[] {
  return INDEXED_LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((locale) => ({ locale }))
}

export function catalogMetadata(locale: StorefrontLocale): Metadata {
  return pageMetadata({
    path: '/catalog',
    locale,
    titleKey: 'seo.catalog.title',
    descriptionKey: 'seo.catalog.description',
  })
}

export function wishlistMetadata(locale: StorefrontLocale): Metadata {
  return pageMetadata({ path: '/wishlist', locale, titleKey: 'seo.wishlist.title' })
}
