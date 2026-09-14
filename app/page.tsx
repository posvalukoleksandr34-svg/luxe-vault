import { About } from '@/components/about'
import { Collections } from '@/components/collections'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Hero } from '@/components/hero'
import { ProductGrid } from '@/components/products/product-grid'
import { Reviews } from '@/components/reviews'
import { SupportWidgetLazy } from '@/components/support-widget-lazy'

// A Server Component: it only arranges sections and holds no state or
// handlers of its own. The sections are client components where they need
// to be (the store, the locale), and they stay so.
export default function Home() {
  return (
    <>
      <Header />

      <main id="main">
        <Hero />
        <Collections />
        <ProductGrid />
        <About />
        <Reviews />
        <Footer />
      </main>

      <SupportWidgetLazy />
    </>
  )
}
