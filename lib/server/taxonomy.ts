import { readCatalog } from '@/lib/server/catalog-store'
import type { LocalizedText, Product } from '@/lib/types'
import { primaryText } from '@/lib/localized-text'

/**
 * The catalogue taxonomy, resolved on the server.
 *
 * The storefront reads its tree from the store, which derives it from the
 * database alone: a catalogue with no departments has no navigation, rather
 * than a built-in list of categories nobody created. The category routes need
 * exactly the same answer BEFORE React runs — to 404 an unknown slug, to build
 * <title>, and to emit the BreadcrumbList a crawler reads. Deriving it here
 * from the same rows is what keeps a route from disagreeing with the sidebar
 * rendered inside it.
 */

export type TaxonomyNode = {
  slug: string
  name: LocalizedText
  /** Short text under the department's title (0064), when written. */
  description?: LocalizedText
  /** Products on sale in it: published, sold out or not. */
  count: number
  categories: { slug: string; name: LocalizedText; count: number }[]
}

/**
 * The catalogue's localised text is per-locale; metadata and JSON-LD are a
 * single string. That single string is the storefront's default language —
 * matching <html lang> and the identical `pick()` on the product page — and
 * never the catalogue's Russian source.
 */
/** Kept under its old name for the category routes; see lib/localized-text.ts. */
export const pick = (text: LocalizedText | undefined): string => primaryText(text)

export async function readTaxonomy(): Promise<{ tree: TaxonomyNode[]; products: Product[] }> {
  const catalog = await readCatalog()
  const { collections, categories, products } = catalog

  // readCatalog() has counted the products on sale in each one.
  const tree: TaxonomyNode[] = collections.map((c) => ({
    slug: c.slug,
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    count: c.count ?? 0,
    categories: categories
      .filter((cat) => cat.collectionSlug === c.slug)
      .map((cat) => ({ slug: cat.slug, name: cat.name, count: cat.count ?? 0 })),
  }))

  return { tree, products }
}

/**
 * One collection, or null.
 *
 * Empty collections are NOT rejected. A collection whose last product just
 * sold out is a real, linkable place that should say "nothing here yet" — 404
 * would break every existing link the moment stock ran out, and the sitemap
 * omits them separately.
 */
export async function findCollection(slug: string): Promise<TaxonomyNode | null> {
  const { tree } = await readTaxonomy()
  return tree.find((n) => n.slug === slug) ?? null
}
