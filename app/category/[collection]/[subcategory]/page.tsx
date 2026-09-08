import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { breadcrumbJsonLd } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { CategoryView } from '@/components/products/category-view'
import { SupportWidget } from '@/components/support-widget'
import { findCollection, pick, readTaxonomy } from '@/lib/server/taxonomy'

/**
 * A subcategory: Hoodies, Sneakers, Caps.
 *
 * The deepest catalogue route, and the one that most needed to exist — these
 * are the pages a search engine can rank for "hoodies" at all. Everything the
 * collection page does, one level down.
 */

export const revalidate = 600
export const dynamicParams = true

const SITE_URL = 'https://luxe-vault.store'

export async function generateStaticParams() {
  const { tree } = await readTaxonomy()
  return tree.flatMap((n) =>
    n.categories.map((c) => ({ collection: n.slug, subcategory: c.slug })),
  )
}

/**
 * Resolves both segments together.
 *
 * A subcategory is only valid UNDER its own collection: /category/shoes/caps
 * must 404 rather than quietly render Caps under the wrong parent, which would
 * be a second URL for the same products and a breadcrumb that lies.
 */
async function resolve(collection: string, subcategory: string) {
  const node = await findCollection(collection)
  if (!node) return null
  const category = node.categories.find((c) => c.slug === subcategory)
  if (!category) return null
  return { node, category }
}

export async function generateMetadata({
  params,
}: {
  params: { collection: string; subcategory: string }
}): Promise<Metadata> {
  const found = await resolve(params.collection, params.subcategory)
  if (!found) return { title: 'Not Found' }

  const groupName = pick(found.node.name) || found.node.slug
  const name = pick(found.category.name) || found.category.slug
  const url = `/category/${found.node.slug}/${found.category.slug}`

  return {
    title: `${name} — ${groupName}`,
    description: `${name} — premium replicas from the ${groupName} collection, shipped from Switzerland.`,
    alternates: { canonical: url },
    openGraph: {
      title: `${name} — LUXE VAULT`,
      url: `${SITE_URL}${url}`,
      type: 'website',
    },
  }
}

export default async function SubcategoryPage({
  params,
}: {
  params: { collection: string; subcategory: string }
}) {
  const found = await resolve(params.collection, params.subcategory)
  if (!found) notFound()

  const groupName = pick(found.node.name) || found.node.slug
  const name = pick(found.category.name) || found.category.slug

  const trail = [
    { name: 'Shop', url: '/#shop' },
    { name: groupName, url: `/category/${found.node.slug}` },
    { name, url: `/category/${found.node.slug}/${found.category.slug}` },
  ]

  return (
    <>
      <Header />

      <main id="main">
        <CategoryView group={found.node.slug} category={found.category.slug} />
        <Footer />
      </main>

      <SupportWidget />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }}
      />
    </>
  )
}
