import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { stylistMetadata } from '@/lib/page-seo'
import { LocalizedBreadcrumbs } from '@/components/localized-breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { StylistExperience } from '@/components/stylist/stylist-experience'
import { StylistIntro } from '@/components/stylist/stylist-intro'
import { SupportWidgetLazy } from '@/components/support-widget-lazy'

/**
 * The AI Stylist route.
 *
 * A page of the shop, with the shop's own header, breadcrumbs and footer — not
 * a widget floating over the catalogue and not a separate app. Someone who
 * lands here from a search result should be able to reach the cart, the
 * account and the collections exactly as from anywhere else.
 */

export const metadata: Metadata = stylistMetadata(DEFAULT_LOCALE)

export default function StylistPage({
  searchParams,
}: {
  searchParams?: { product?: string }
}) {
  // `?product=` is the product page's "Style this piece" entry point: the look
  // is built around that piece instead of from scratch.
  const anchor = typeof searchParams?.product === 'string' ? searchParams.product : undefined

  return (
    <>
      <Header />

      <main id="main" className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6 lg:px-10 lg:py-16">
        <LocalizedBreadcrumbs
          items={[
            { key: 'nav.shop', url: '/catalog' },
            { key: 'stylist.title', url: '/stylist' },
          ]}
        />

        {/* The visible heading is localised, so it cannot sit in this server
            component's static markup while the questions below it speak the
            visitor's language. The <title> and description stay English —
            metadata has one canonical locale, same as everywhere else. */}
        <StylistIntro />

        <StylistExperience anchorProductId={anchor} />
      </main>

      <Footer />
      <SupportWidgetLazy />
    </>
  )
}
