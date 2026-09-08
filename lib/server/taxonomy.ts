import { readCatalog } from '@/lib/server/catalog-store'
import { CATEGORY_LABELS, GROUP_LABELS } from '@/lib/i18n'
import { CATEGORY_TREE } from '@/lib/data'
import type { LocalizedText, Product } from '@/lib/types'

/**
 * The catalogue taxonomy, resolved on the server.
 *
 * The storefront reads its tree from the store, which derives it from the
 * database and falls back to the seeded CATEGORY_TREE when no collections
 * exist. The category routes need exactly the same answer BEFORE React runs —
 * to 404 an unknown slug, to build <title>, and to emit the BreadcrumbList a
 * crawler reads. Re-deriving it here from the same two sources, with the same
 * fallback, is what keeps a route from disagreeing with the sidebar rendered
 * inside it.
 */

export type TaxonomyNode = {
  slug: string
  name: LocalizedText
  count: number
  categories: { slug: string; name: LocalizedText; count: number }[]
}

/**
 * The catalogue's localised text is per-locale; metadata and JSON-LD are a
 * single string. Russian is the site default and the authoritative content, so
 * it is the source for both — matching <html lang="ru"> and the identical
 * `pick()` on the product page.
 */
export function pick(text: LocalizedText | undefined): string {
  if (!text) return ''
  return text.ru || text.en || Object.values(text)[0] || ''
}

export async function readTaxonomy(): Promise<{ tree: TaxonomyNode[]; products: Product[] }> {
  const catalog = await readCatalog()
  const { collections, categories, products } = catalog

  const countIn = (group: string, category?: string) =>
    products.filter((p) => p.group === group && (category === undefined || p.category === category))
      .length

  // Same shape either way, so the routes never branch on which source won.
  const tree: TaxonomyNode[] =
    collections.length === 0
      ? CATEGORY_TREE.map((n) => ({
          slug: n.group,
          name: GROUP_LABELS[n.group] ?? { ru: n.group },
          count: countIn(n.group),
          categories: n.items.map((c) => ({
            slug: c,
            name: CATEGORY_LABELS[c] ?? { ru: c },
            count: countIn(n.group, c),
          })),
        }))
      : collections.map((c) => ({
          slug: c.slug,
          name: c.name,
          count: countIn(c.slug),
          categories: categories
            .filter((cat) => cat.collectionSlug === c.slug)
            .map((cat) => ({
              slug: cat.slug,
              name: cat.name,
              count: countIn(c.slug, cat.slug),
            })),
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
