import type { Metadata } from 'next'

import { DEFAULT_LOCALE, UI, translate, type UIKey } from '@/lib/i18n'
import { INDEXED_LOCALES } from '@/lib/locale-routing'
import { resolveDoc, type LegalDocSet } from '@/app/legal/_content/types'
import { pageMetadata } from '@/lib/seo'
import { getProductBySlug } from '@/lib/server/catalog-store'
import { findCollection } from '@/lib/server/taxonomy'
import type { StorefrontLocale } from '@/lib/types'

/**
 * Per-page metadata builders, shared by each storefront route and its
 * localised twin under app/[locale].
 *
 * They live here rather than beside their routes because Next allows a
 * page.tsx to export only its own conventional names — a second export from
 * one is a build error. One module for all of them also makes the set of
 * indexable pages readable in one place, and guarantees the two routes that
 * serve a page can never describe it differently.
 */

/** The languages a localised route is prerendered for: every one with URLs,
 *  minus the default, which is served by the unprefixed route. */
export function localeStaticParams(): { locale: StorefrontLocale }[] {
  return INDEXED_LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((locale) => ({ locale }))
}

/** `{name}`-style substitution against the dictionary, for a server component
 *  that cannot reach the store's `tf()`. */
function fill(key: UIKey, locale: StorefrontLocale, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (out, [name, value]) => out.split(`{${name}}`).join(value),
    translate(UI[key], locale),
  )
}

// ---------------------------------------------------------------- storefront

export function homeMetadata(locale: StorefrontLocale): Metadata {
  // No title: the homepage keeps the root layout's full site title, which is
  // the brand line a search for the shop's own name should return.
  return pageMetadata({ path: '/', locale, descriptionKey: 'seo.home.description' })
}

export function catalogMetadata(locale: StorefrontLocale): Metadata {
  return pageMetadata({
    path: '/catalog',
    locale,
    titleKey: 'seo.catalog.title',
    descriptionKey: 'seo.catalog.description',
  })
}

export function contactMetadata(locale: StorefrontLocale): Metadata {
  return pageMetadata({
    path: '/contact',
    locale,
    titleKey: 'seo.contact.title',
    descriptionKey: 'seo.contact.description',
  })
}

export function supportMetadata(locale: StorefrontLocale): Metadata {
  return pageMetadata({
    path: '/support',
    locale,
    titleKey: 'seo.support.title',
    descriptionKey: 'seo.support.description',
  })
}

/** Noindex: an interactive tool whose output differs per visitor, so there is
 *  no stable content to rank. It still gets a URL per language, because a link
 *  to it from an Italian page should stay Italian. */
export function stylistMetadata(locale: StorefrontLocale): Metadata {
  return pageMetadata({
    path: '/stylist',
    locale,
    titleKey: 'seo.stylist.title',
    descriptionKey: 'seo.stylist.description',
    noindex: true,
  })
}

/** Noindex: the contents live in one browser's localStorage, so there is
 *  nothing here that would be the same for two people. */
export function wishlistMetadata(locale: StorefrontLocale): Metadata {
  return pageMetadata({ path: '/wishlist', locale, titleKey: 'seo.wishlist.title', noindex: true })
}

// ------------------------------------------------------------------ taxonomy

/** A collection: Clothing, Shoes, Accessories. `subcategories` is the joined
 *  list of what it contains, which is what makes the description specific. */
export function collectionMetadata(
  locale: StorefrontLocale,
  slug: string,
  name: string,
  subcategories: string,
): Metadata {
  return pageMetadata({
    path: `/category/${slug}`,
    locale,
    title: name,
    description: subcategories
      ? fill('seo.category.description', locale, { name, items: subcategories })
      : fill('seo.category.plain', locale, { name }),
  })
}

export function subcategoryMetadata(
  locale: StorefrontLocale,
  collection: string,
  subcategory: string,
  name: string,
  groupName: string,
): Metadata {
  return pageMetadata({
    path: `/category/${collection}/${subcategory}`,
    locale,
    title: `${name} — ${groupName}`,
    description: fill('seo.category.plain', locale, { name: `${name} — ${groupName}` }),
  })
}

// ------------------------------------------------------------------- product

export function productMetadata(
  locale: StorefrontLocale,
  slug: string,
  name: string,
  description: string,
): Metadata {
  return pageMetadata({
    path: `/product/${slug}`,
    locale,
    title: name,
    description: description || fill('seo.product.fallback', locale, { name }),
  })
}

// ---------------------------------------------------- taxonomy, from the DB

/**
 * A collection page's metadata, in one language.
 *
 * Shared by /category/[collection] and its localised twin, and async because
 * the taxonomy lives in Postgres. The collection's NAME is read in the
 * requested language — `translate`, not taxonomy's `pick`, which always
 * answers in the default. A page titled "Clothing" whose body says
 * "Abbigliamento" is the mismatch these URLs exist to end.
 */
export async function collectionMetadataFor(
  collection: string,
  locale: StorefrontLocale,
): Promise<Metadata> {
  const node = await findCollection(collection)
  if (!node) return { title: 'Not Found' }

  const name = translate(node.name, locale) || node.slug
  const subcategories = node.categories
    .map((c) => translate(c.name, locale))
    .filter(Boolean)
    .join(', ')

  return collectionMetadata(locale, node.slug, name, subcategories)
}

/**
 * A subcategory page's metadata.
 *
 * A subcategory is only valid UNDER its own collection, so an unmatched pair
 * answers "Not Found" here exactly as the route itself 404s — the title must
 * not describe a page that will not render.
 */
export async function subcategoryMetadataFor(
  collection: string,
  subcategory: string,
  locale: StorefrontLocale,
): Promise<Metadata> {
  const node = await findCollection(collection)
  const category = node?.categories.find((c) => c.slug === subcategory)
  if (!node || !category) return { title: 'Not Found' }

  const groupName = translate(node.name, locale) || node.slug
  const name = translate(category.name, locale) || category.slug

  return subcategoryMetadata(locale, node.slug, category.slug, name, groupName)
}

// ----------------------------------------------------- product, from the DB

/** Meta descriptions are cut by the search engine at roughly this length, so
 *  the sentence is ended here rather than mid-word by Google. */
const DESCRIPTION_MAX = 160

function truncate(text: string, max = DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1).replace(/[\s,;:.!-]+\S*$/, '')}\u2026`
}

/**
 * A product page's metadata, in one language.
 *
 * Name and description are read in the REQUESTED language — this is the page
 * whose title is most likely to be what someone searched for, so an Italian
 * result showing an English product name is the costliest version of the
 * mismatch. `translate` falls back through the other European languages and
 * never to Russian (lib/i18n.ts).
 */
export async function productMetadataFor(slug: string, locale: StorefrontLocale): Promise<Metadata> {
  let product = null
  try {
    product = await getProductBySlug(slug)
  } catch {
    // A database blip must not fail the build or the request; the page itself
    // handles the same error.
  }

  if (!product) {
    // noindex, so a transient lookup failure cannot get an empty page indexed.
    return { title: 'Product not found', robots: { index: false, follow: true } }
  }

  const name = translate(product.name, locale) || product.id
  // The fallback is only reached for a product with no description at all. It
  // leads with the product's own brand when it has one, so the sentence says
  // something specific rather than repeating boilerplate.
  const described = truncate(translate(product.description, locale))
  const description =
    described || [product.brand, fill('seo.product.fallback', locale, { name })].filter(Boolean).join(' \u00b7 ')

  return productMetadata(locale, product.id, name, description)
}

// --------------------------------------------------------------------- legal

/**
 * A legal document's metadata, in one language.
 *
 * The title and description are the DOCUMENT's own, in the language it
 * resolves to — `resolveDoc` falls back to English for a language the document
 * has not been translated into, and reports that it did. The tab then matches
 * the text on the page, which is the whole reason these are data rather than
 * hardcoded markup.
 */
export function legalMetadata(set: LegalDocSet, path: string, locale: StorefrontLocale): Metadata {
  const { doc } = resolveDoc(set, locale)
  return pageMetadata({ path, locale, title: doc.title, description: doc.description })
}
