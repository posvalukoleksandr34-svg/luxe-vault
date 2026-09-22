import type { Metadata } from 'next'
import { breadcrumbJsonLd } from '@/components/breadcrumbs'
import { CatalogView } from '@/components/products/catalog-view'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { serializeJsonLd } from '@/lib/json-ld'
import { itemListJsonLd } from '@/lib/seo'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { catalogMetadata } from '@/lib/page-seo'
import { readCatalog } from '@/lib/server/catalog-store'

export const metadata: Metadata = catalogMetadata(DEFAULT_LOCALE)

/**
 * The catalogue as a page of its own.
 *
 * It replaces the `/catalog → /#shop` redirect that used to send every visitor
 * to the homepage's shop section — an intermediate screen between choosing a
 * department and seeing the products.
 */
// The catalogue is what changes most often, and this page is the one a
// crawler is most likely to re-fetch. Matching the category routes' window
// keeps a newly added piece visible here without a redeploy.
export const revalidate = 600

export default async function CatalogPage() {
  // A failed read must not take the page down — the grid fetches for itself on
  // mount — so the listing schema is simply omitted when the catalogue is
  // unavailable rather than asserted as empty, which would tell Google this
  // shop sells nothing.
  let products: Awaited<ReturnType<typeof readCatalog>>['products'] = []
  try {
    products = (await readCatalog()).products
  } catch (error) {
    console.error('[catalog] products unavailable for structured data:', error)
  }

  return (
    <>
      <Header />
      <main id="main">
        <CatalogView />
        <Footer />
      </main>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(breadcrumbJsonLd([{ name: 'Shop', url: '/catalog' }])),
        }}
      />
      {products.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListJsonLd(products, '/catalog', 'Catalogue')) }}
        />
      )}
    </>
  )
}
