import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs, breadcrumbJsonLd } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { ProductDetail } from '@/components/products/product-detail'
import { RecentlyViewed, RelatedProducts } from '@/components/products/product-rail'
import { ProductReviews } from '@/components/products/product-reviews'
import { SHIPPING, TOTAL_WINDOW } from '@/lib/fulfilment'
import { CATEGORY_LABELS, GROUP_LABELS } from '@/lib/i18n'
import { getProductBySlug } from '@/lib/server/catalog-store'
import type { Product } from '@/lib/types'

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

const SITE_URL = 'https://luxe-vault.store'

// `Product.id` IS `products.slug` — rowToProduct maps that column onto the id,
// so the URL segment and the record key are the same value by construction and
// there is no second field to keep in sync.

/**
 * The catalogue stores localised text; metadata is a single string. Russian is
 * the site's default locale and the authoritative content, so it is the source
 * for tags — matching <html lang="ru">.
 */
function pick(text: Record<string, string> | undefined): string {
  if (!text) return ''
  return text.ru || text.en || Object.values(text)[0] || ''
}

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
  let product: Product | null = null
  try {
    product = await getProductBySlug(params.slug)
  } catch {
    // A database blip must not fail the build or the request; the page itself
    // handles the same error below.
  }

  if (!product) {
    // noindex, so a transient lookup failure cannot get an empty page indexed.
    return { title: 'Product not found', robots: { index: false, follow: true } }
  }

  const name = pick(product.name)
  const description =
    truncate(pick(product.description)) ||
    `${name} — premium replica from Luxe Vault. Designer-inspired, limited drops, shipped from Switzerland.`
  const url = `${SITE_URL}/product/${product.id}`

  return {
    // The root layout's template appends " — LUXE VAULT", giving exactly the
    // "{ProductName} | LUXE VAULT" shape asked for, with one separator style
    // across the whole site rather than two.
    title: name,
    description,
    alternates: { canonical: `/product/${product.id}` },
    openGraph: {
      type: 'website',
      url,
      siteName: 'LUXE VAULT',
      title: `${name} — LUXE VAULT`,
      description,
      // Absolute, because Telegram/WhatsApp/Discord will not resolve a relative
      // og:image. metadataBase in the root layout handles the rest.
      images: product.image ? [{ url: product.image, alt: name }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} — LUXE VAULT`,
      description,
      images: product.image ? [product.image] : undefined,
    },
  }
}

/**
 * schema.org/Product as JSON-LD.
 *
 * `brand` is Luxe Vault, never the designer name the item imitates. Declaring
 * someone else's brand here would be a machine-readable assertion that these
 * are that brand's goods — the same false authenticity claim the product
 * copy, the Terms and the replica badge all exist to avoid, except stated in
 * the format search engines trust most.
 */
function productJsonLd(product: Product) {
  const name = pick(product.name)
  const slug = product.id
  const outOfStock = product.statuses.includes('out_of_stock')

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: pick(product.description),
    sku: slug,
    image: product.images?.length ? product.images : product.image ? [product.image] : undefined,
    brand: { '@type': 'Brand', name: 'Luxe Vault' },
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
      seller: { '@type': 'Organization', name: 'Luxe Vault' },
      // Google flags an offer with no validity window as incomplete. A year
      // out is honest for a catalogue that is restocked rather than retired.
      priceValidUntil: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          value: SHIPPING.standard.price.toFixed(2),
          currency: 'CHF',
        },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          // The same window the customer is quoted at checkout, from the one
          // place that owns it — a schema that disagrees with the storefront
          // is worse than none.
          transitTime: {
            '@type': 'QuantitativeValue',
            minValue: TOTAL_WINDOW.min,
            maxValue: TOTAL_WINDOW.max,
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

  // Shop → collection → category → product. The collection and category
  // crumbs point at their own routes now; they used to point back at the
  // homepage anchor because those routes did not exist and a breadcrumb that
  // 404s is worse than one that lands a level up.
  const trail = [
    { name: 'Shop', url: '/#shop' },
    ...(product.group
      ? [
          {
            name: pick(GROUP_LABELS[product.group]) || product.group,
            url: `/category/${product.group}`,
          },
        ]
      : []),
    ...(product.group && product.category
      ? [
          {
            name: pick(CATEGORY_LABELS[product.category]) || product.category,
            url: `/category/${product.group}/${product.category}`,
          },
        ]
      : []),
    { name: pick(product.name), url: `/product/${product.id}` },
  ]

  return (
    <>
      <Header />

      <main id="main" className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
        <Breadcrumbs trail={trail} />

        <ProductDetail product={product} />

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
        // The payload is built from our own database rows, not user input, and
        // JSON.stringify escapes the values.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(product)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd(trail)),
        }}
      />
    </>
  )
}
