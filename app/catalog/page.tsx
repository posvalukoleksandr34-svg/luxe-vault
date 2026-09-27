import type { Metadata } from 'next'
import { breadcrumbJsonLd } from '@/components/breadcrumbs'
import { CatalogView } from '@/components/products/catalog-view'
import { ListingProvider } from '@/components/products/listing-context'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { serializeJsonLd } from '@/lib/json-ld'
import { itemListJsonLd } from '@/lib/seo'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { catalogMetadata } from '@/lib/page-seo'
import { readCatalog } from '@/lib/server/catalog-store'
import { listingCounts, pageLocale, toListing } from '@/lib/server/catalog-listing'
import type { Product } from '@/lib/types'

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

export default async function CatalogPage({ params }: { params?: { locale?: string } }) {
  // A failed read must not take the page down — without a listing the grid
  // fetches the catalogue for itself — so the listing schema is simply omitted
  // when the catalogue is unavailable rather than asserted as empty, which
  // would tell Google this shop sells nothing.
  let products: Product[] = []
  let readOk = false
  try {
    products = (await readCatalog()).products
    readOk = true
  } catch (error) {
    console.error('[catalog] products unavailable for structured data:', error)
  }

  const view = <CatalogView />

  return (
    <>
      <Header />
      <main id="main">
        {/* The grid's products, trimmed to what a listing shows and to this
            page's language — see lib/server/catalog-listing.ts. */}
        {readOk ? (
          <ListingProvider products={toListing(products, pageLocale(params))} counts={listingCounts(products)}>
            {view}
          </ListingProvider>
        ) : (
          view
        )}
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
