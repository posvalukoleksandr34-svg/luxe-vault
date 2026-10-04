import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { homeMetadata } from '@/lib/page-seo'
import { AppPromoBanner } from '@/components/app-promo-banner'
import { Footer } from '@/components/footer'
import { HashScroll } from '@/components/hash-scroll'
import { Header } from '@/components/header'
import { Hero } from '@/components/hero'
import { Reviews } from '@/components/reviews'
import { SectionsGrid } from '@/components/sections-grid'
import { SupportWidgetLazy } from '@/components/support-widget-lazy'
import {
  FeaturedProducts,
  FinalCta,
  HomeFaq,
  HowOrdering,
  TrustBar,
  WhyLuxeVault,
} from '@/components/home/home-sections'
import { readCatalog } from '@/lib/server/catalog-store'
import type { Product } from '@/lib/types'

// The homepage's own canonical, description and hreflang. The canonical used
// to sit in the root layout, where every page without one of its own inherited
// it — see the note there. The TITLE still comes from the layout's default:
// it is the brand line, and a search for the shop's own name should return it
// rather than a section heading.
export const metadata: Metadata = homeMetadata(DEFAULT_LOCALE)

/** How many pieces the homepage shows. Two rows of four on a desktop. */
const FEATURED_COUNT = 8

/**
 * A few pieces for the homepage: available ones only, newest first. Chosen
 * on the server from the cached catalogue — the browser never downloads the
 * catalogue to pick eight products from it. A failed read costs the section,
 * never the page.
 */
async function featuredProducts(): Promise<Product[]> {
  try {
    const { products } = await readCatalog()
    const available = products.filter(
      (p) =>
        !p.statuses.includes('out_of_stock') &&
        !(p.variants && p.variants.length > 0 && p.variants.every((v) => v.stock <= 0)),
    )
    const fresh = available.filter((p) => p.isNew)
    const rest = available.filter((p) => !p.isNew)
    return [...fresh, ...rest].slice(0, FEATURED_COUNT)
  } catch (error) {
    console.error('[home] featured products unavailable:', error)
    return []
  }
}

/**
 * A Server Component: it arranges sections and picks the featured products;
 * the sections are client components where they need the store.
 *
 * Order follows what a first visit needs: what this is (hero), why it can be
 * trusted (trust bar), what it sells (featured, departments), why buy here,
 * how buying works, what others said, the questions people ask, and one
 * last invitation.
 */
export default async function Home() {
  const featured = await featuredProducts()
  return (
    <>
      <Header />

      <main id="main">
        <Hero />
        <TrustBar />
        <FeaturedProducts products={featured} />
        <SectionsGrid />
        <WhyLuxeVault />
        <HowOrdering />
        <Reviews />
        <HomeFaq />
        <FinalCta />
        <AppPromoBanner />
        <Footer />
      </main>

      <SupportWidgetLazy />
      <HashScroll />
    </>
  )
}
