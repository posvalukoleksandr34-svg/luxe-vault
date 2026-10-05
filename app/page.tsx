import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { homeMetadata } from '@/lib/page-seo'
import { Footer } from '@/components/footer'
import { HashScroll } from '@/components/hash-scroll'
import { Header } from '@/components/header'
import { Hero } from '@/components/hero'
import { SectionsGrid } from '@/components/sections-grid'
import { SupportWidgetLazy } from '@/components/support-widget-lazy'
import { FeaturedProducts, TrustBar } from '@/components/home/home-sections'
import { readCatalog } from '@/lib/server/catalog-store'
import { unitsSoldByProduct } from '@/lib/server/popular-products'
import type { Product } from '@/lib/types'

// The homepage's own canonical, description and hreflang. The canonical used
// to sit in the root layout, where every page without one of its own inherited
// it — see the note there. The TITLE still comes from the layout's default:
// it is the brand line, and a search for the shop's own name should return it
// rather than a section heading.
export const metadata: Metadata = homeMetadata(DEFAULT_LOCALE)

/** How many pieces the homepage shows: one row of four. */
const FEATURED_COUNT = 4

/**
 * The four most popular pieces, chosen on the server from the cached
 * catalogue. The browser never downloads the catalogue to pick four products
 * from it, and a failed read costs the section, never the page.
 *
 * Order: available pieces first, ranked by units sold in paid orders over
 * the last six months (lib/server/popular-products.ts), then new arrivals,
 * then catalogue order. Sold-out pieces only fill the row when fewer than
 * four are available — the row is always four wide while the catalogue has
 * four products. Without sales data (a new shop, or the read failing) the
 * ranking is simply available-and-newest.
 */
async function featuredProducts(): Promise<Product[]> {
  try {
    const [{ products }, sold] = await Promise.all([
      readCatalog(),
      unitsSoldByProduct().catch((error) => {
        console.error('[home] sales ranking unavailable:', error)
        return new Map<string, number>()
      }),
    ])
    const available = (p: Product) =>
      !p.statuses.includes('out_of_stock') &&
      !(p.variants && p.variants.length > 0 && p.variants.every((v) => v.stock <= 0))
    return products
      .map((p, index) => ({ p, index, available: available(p), sold: sold.get(p.id) ?? 0 }))
      .sort(
        (a, b) =>
          Number(b.available) - Number(a.available) ||
          b.sold - a.sold ||
          Number(Boolean(b.p.isNew)) - Number(Boolean(a.p.isNew)) ||
          a.index - b.index,
      )
      .slice(0, FEATURED_COUNT)
      .map((x) => x.p)
  } catch (error) {
    console.error('[home] featured products unavailable:', error)
    return []
  }
}

/**
 * A Server Component: it arranges the sections and picks the products; the
 * sections are client components where they need the store.
 *
 * Deliberately short — a boutique's front window, not a brochure: what this
 * is (hero, with its four facts beneath), where to go (the departments),
 * what is popular (four pieces), and the footer with the newsletter. About,
 * Shipping, Returns, FAQ and Contact are their own pages, in the header.
 */
export default async function Home() {
  const featured = await featuredProducts()
  return (
    <>
      <Header />

      <main id="main">
        <Hero />
        <TrustBar />
        <SectionsGrid />
        <FeaturedProducts products={featured} />
        <Footer />
      </main>

      <SupportWidgetLazy />
      <HashScroll />
    </>
  )
}
