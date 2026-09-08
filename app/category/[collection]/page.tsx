import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { breadcrumbJsonLd } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { CategoryView } from '@/components/products/category-view'
import { SupportWidget } from '@/components/support-widget'
import { findCollection, pick, readTaxonomy } from '@/lib/server/taxonomy'

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

const SITE_URL = 'https://luxe-vault.store'

export async function generateStaticParams() {
  const { tree } = await readTaxonomy()
  return tree.map((n) => ({ collection: n.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: { collection: string }
}): Promise<Metadata> {
  const node = await findCollection(params.collection)
  if (!node) return { title: 'Not Found' }

  const name = pick(node.name) || node.slug
  const subcategories = node.categories.map((c) => pick(c.name)).filter(Boolean).join(', ')

  return {
    title: name,
    description: subcategories
      ? `${name} — ${subcategories}. Premium replicas shipped from Switzerland.`
      : `${name} — premium replicas shipped from Switzerland.`,
    alternates: { canonical: `/category/${node.slug}` },
    openGraph: {
      title: `${name} — LUXE VAULT`,
      url: `${SITE_URL}/category/${node.slug}`,
      type: 'website',
    },
  }
}

export default async function CollectionPage({ params }: { params: { collection: string } }) {
  const node = await findCollection(params.collection)
  if (!node) notFound()

  const name = pick(node.name) || node.slug
  const trail = [
    { name: 'Shop', url: '/#shop' },
    { name, url: `/category/${node.slug}` },
  ]

  return (
    <>
      <Header />

      <main id="main">
        <CategoryView group={node.slug} />
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
