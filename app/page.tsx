import type { Metadata } from 'next'
import { About } from '@/components/about'
import { AppPromoBanner } from '@/components/app-promo-banner'
import { Footer } from '@/components/footer'
import { HashScroll } from '@/components/hash-scroll'
import { Header } from '@/components/header'
import { Hero } from '@/components/hero'
import { ProductGrid } from '@/components/products/product-grid'
import { Reviews } from '@/components/reviews'
import { SectionsGrid } from '@/components/sections-grid'
import { SupportWidgetLazy } from '@/components/support-widget-lazy'

// The homepage's own canonical. It used to sit in the root layout, where every
// page without one of its own inherited it — see the note there. Title,
// description and Open Graph come from the layout's defaults.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

// A Server Component: it only arranges sections and holds no state or
// handlers of its own. The sections are client components where they need
// to be (the store, the locale), and they stay so.
export default function Home() {
  return (
    <>
      <Header />

      <main id="main">
        <Hero />
        <SectionsGrid />
        <ProductGrid />
        <About />
        <Reviews />
        <AppPromoBanner />
        <Footer />
      </main>

      <SupportWidgetLazy />
      <HashScroll />
    </>
  )
}
