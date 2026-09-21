import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { breadcrumbJsonLd } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { CategoryView } from '@/components/products/category-view'
import { SupportWidgetLazy } from '@/components/support-widget-lazy'
import { findCollection, pick, readTaxonomy } from '@/lib/server/taxonomy'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { serializeJsonLd } from '@/lib/json-ld'
import { collectionMetadataFor } from '@/lib/page-seo'
import { SITE_ORIGIN, itemListJsonLd } from '@/lib/seo'

/**
 * A collection: Clothing, Shoes, Accessories.
 *
 * The catalogue used to live entirely on the homepage — the collection cards
 * set a filter and scrolled to `#shop`, so there was no URL for "Clothing" to
 * link to, share, or index. This is that URL.
 *
 * A server component for the same reason the product page is one: the title,
 * the canonical link and the BreadcrumbList are in the initial HTML, so a
 * crawler sees a real category page rather than an empty shell.
 */

// Matches the product page. The taxonomy changes rarely and a crawler walking
// every category should not hit the database each time; an admin's new
// collection appears within the window.
export const revalidate = 600
export const dynamicParams = true

const SITE_URL = SITE_ORIGIN

export async function generateStaticParams() {
  const { tree } = await readTaxonomy()
  return tree.map((n) => ({ collection: n.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: { collection: string }
}): Promise<Metadata> {
  return collectionMetadataFor(params.collection, DEFAULT_LOCALE)
}

export default async function CollectionPage({ params }: { params: { collection: string } }) {
  const node = await findCollection(params.collection)
  if (!node) notFound()

  const name = pick(node.name) || node.slug
  const trail = [
    { name: 'Shop', url: '/catalog' },
    { name, url: `/category/${node.slug}` },
  ]

  // The pieces this listing holds, as an ItemList beside the breadcrumbs. The
  // grid itself is a client component that filters on the store, so the list
  // is read here from the same taxonomy the route resolves — a crawler sees
  // what the page shows without waiting for hydration.
  const { products } = await readTaxonomy()
  const listed = products.filter((p) => p.group === node.slug)

  return (
    <>
      <Header />

      <main id="main">
        <CategoryView group={node.slug} />
        <Footer />
      </main>

      <SupportWidgetLazy />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd(trail)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListJsonLd(listed, `/category/${node.slug}`, name)) }}
      />
    </>
  )
}
