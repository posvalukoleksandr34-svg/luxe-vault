import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { ProductDetailSkeleton } from '@/components/skeletons'
import { DEFAULT_LOCALE, UI, translate } from '@/lib/i18n'

/**
 * Shown while a product page is fetched — the route is server-rendered per
 * request, so this is what stands between a tap on a card and the product.
 *
 * Matches the page's own container and breadcrumb spacing, so the gallery
 * lands exactly where its placeholder was. See the note in app/catalog/
 * loading.tsx on why this is a server component with a dictionary label.
 */
export default function ProductLoading() {
  return (
    <>
      <Header />
      <main id="main" className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
        <div className="mb-8 h-3 w-64 animate-pulse bg-white/[0.06]" />
        <ProductDetailSkeleton label={translate(UI['state.loadingProduct'], DEFAULT_LOCALE)} />
      </main>
      <Footer />
    </>
  )
}
