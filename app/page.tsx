import type { Metadata } from 'next'
import { About } from '@/components/about'
import { AppPromoBanner } from '@/components/app-promo-banner'
import { Footer } from '@/components/footer'
import { HashScroll } from '@/components/hash-scroll'
import { Header } from '@/components/header'
import { Hero } from '@/components/hero'
import { Reviews } from '@/components/reviews'
import { SectionsGrid } from '@/components/sections-grid'
import { SupportWidgetLazy } from '@/components/support-widget-lazy'

// The homepage's own canonical. It used to sit in the root layout, where every
// page without one of its own inherited it — see the note there. Title,
// description and Open Graph come from the layout's defaults.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

/**
 * A Server Component: it only arranges sections and holds no state or handlers
 * of its own. The sections are client components where they need to be (the
 * store, the locale), and they stay so.
 *
 * NO PRODUCTS HERE. The homepage is the brand's entrance: hero, departments,
 * the story, reviews. Scrolling it never reaches a grid — products live at
 * /catalog and /category/<department>, where the sidebar and the filters are,
 * and where the URL says what is on screen.
 */
export default function Home() {
  return (
    <>
      <Header />

      <main id="main">
        <Hero />
        <SectionsGrid />
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
