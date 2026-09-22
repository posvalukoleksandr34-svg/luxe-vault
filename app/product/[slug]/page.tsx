import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { breadcrumbJsonLd } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { ProductDetail } from '@/components/products/product-detail'
import { RecentlyViewed, RelatedProducts } from '@/components/products/product-rail'
import { ProductReviews } from '@/components/products/product-reviews'
import { ProductTrail } from '@/components/products/product-trail'
import { StyleThisPiece } from '@/components/products/style-this-piece'
import type { ShippingSettings } from '@/config/shipping'
import { businessToCalendarDays, deliveryDaysFor, quoteShipping } from '@/lib/fulfilment'
import { CATEGORY_LABELS, GROUP_LABELS } from '@/lib/i18n'
import { getProductBySlug } from '@/lib/server/catalog-store'
import { getShippingSettings } from '@/lib/server/store-settings'
import type { Product } from '@/lib/types'
import { serializeJsonLd } from '@/lib/json-ld'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { productMetadataFor } from '@/lib/page-seo'
import { BRAND_ID, ORGANIZATION_ID, SITE_ORIGIN } from '@/lib/seo'
import { primaryText } from '@/lib/localized-text'

/**
 * Dedicated product page.
 *
 * A server component on purpose. The product data, <title>, OpenGraph tags and
 * JSON-LD are all produced on the server, so a crawler sees them in the initial
 * HTML. Rendering this on the client would leave Googlebot an empty shell and
 * defeat the entire point of moving off the modal.
 */

// Product pages are cached and revalidated rather than rendered per request:
// the catalogue changes rarely, and a crawler hitting every product should not
// hit the database every time. An admin edit is visible within the window.
export const revalidate = 600
// A product added after the last build must still resolve rather than 404, so
// unknown slugs are rendered on demand.
export const dynamicParams = true

const SITE_URL = SITE_ORIGIN

// `Product.id` IS `products.slug` — rowToProduct maps that column onto the id,
// so the URL segment and the record key are the same value by construction and
// there is no second field to keep in sync.

/**
 * The catalogue stores localised text; metadata is a single string. Russian is
 * the site's default locale and the authoritative content, so it is the source
 * for tags — matching <html lang="ru">.
 * Read through primaryText() (lib/localized-text.ts).
 */

/** Trimmed to Google's snippet limit so the description is not cut mid-word. */
function truncate(s: string, max = 155): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1).replace(/[\s,;:.!-]+\S*$/, '')}…`
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  return productMetadataFor(params.slug, DEFAULT_LOCALE)
}

/**
 * schema.org/Product as JSON-LD.
 *
 * `brand` stays Luxe Vault — the seller — and deliberately does NOT follow
 * the product's own brand field, which is free text an admin can set to any
 * designer name. Declaring someone else's brand here would be a
 * machine-readable assertion that these are that brand's goods, in the format
 * search engines trust most, which is a claim the Terms explicitly deny.
 * Displaying a name on the page is description; asserting it in structured
 * data is provenance.
 */
function productJsonLd(product: Product, shipping: ShippingSettings) {
  // Calendar days, like every per-product window: the admin's business-day
  // timeframe converted when the product has no window of its own.
  const days = deliveryDaysFor(product, businessToCalendarDays(shipping.deliveryTimeframe))
  const name = primaryText(product.name)
  const slug = product.id
  const outOfStock = product.statuses.includes('out_of_stock')

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: primaryText(product.description),
    sku: slug,
    image: product.images?.length ? product.images : product.image ? [product.image] : undefined,
    // The shop's own Brand node from the root layout's graph, by @id, so a
    // crawler reads one brand across the catalogue rather than a separate
    // anonymous one per product.
    brand: { '@id': BRAND_ID },
    offers: {
      '@type': 'Offer',
      url: `${SITE_URL}/product/${slug}`,
      priceCurrency: 'CHF',
      // Schema.org expects a plain decimal string — "CHF 249.00" or a number
      // with a thousands separator is silently dropped by Google's parser.
      price: product.price.toFixed(2),
      availability: outOfStock
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': ORGANIZATION_ID },
      // Google flags an offer with no validity window as incomplete. A year
      // out is honest for a catalogue that is restocked rather than retired.
      priceValidUntil: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          // What delivery costs for this piece on its own — free when its
          // price alone clears the threshold.
          value: quoteShipping(product.price, shipping).toFixed(2),
          currency: 'CHF',
        },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          // This product's own window — the one its page shows and its
          // order is stamped with. A schema that disagrees with the
          // storefront is worse than none.
          transitTime: {
            '@type': 'QuantitativeValue',
            minValue: days.min,
            maxValue: days.max,
            unitCode: 'DAY',
          },
        },
      },
    },
  }
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const product = await getProductBySlug(params.slug)
  if (!product) notFound()
  const shipping = await getShippingSettings()

  // Shop → collection → category → product. The collection and category
  // crumbs point at their own routes now; they used to point back at the
  // homepage anchor because those routes did not exist and a breadcrumb that
  // 404s is worse than one that lands a level up.
  const trail = [
    { name: 'Shop', url: '/catalog' },
    ...(product.group
      ? [
          {
            name: primaryText(GROUP_LABELS[product.group]) || product.group,
            url: `/category/${product.group}`,
          },
        ]
      : []),
    ...(product.group && product.category
      ? [
          {
            name: primaryText(CATEGORY_LABELS[product.category]) || product.category,
            url: `/category/${product.group}/${product.category}`,
          },
        ]
      : []),
    { name: primaryText(product.name), url: `/product/${product.id}` },
  ]

  return (
    <>
      <Header />

      <main id="main" className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
        {/* Visible trail in the visitor's language; `trail` above stays the
            server's default-locale source for the BreadcrumbList JSON-LD. */}
        <ProductTrail product={product} />

        <ProductDetail product={product} />

        <StyleThisPiece product={product} />

        {/* Everything below the fold. Client components reading the catalogue
            already in the store, so none of them costs a request. */}
        <ProductReviews productId={product.id} />
        <RelatedProducts product={product} />
        <RecentlyViewed currentId={product.id} />
      </main>

      <Footer />

      {/* Rendered by the server, so it is present in the initial HTML where
          crawlers read it. */}
      <script
        type="application/ld+json"
        // Catalogue text is editable and imported, so it is serialised with
        // `<`, `>` and `&` escaped — plain JSON.stringify would let a
        // "</script>" in a product name break out of this element.
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd(product, shipping)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(breadcrumbJsonLd(trail)),
        }}
      />
    </>
  )
}
