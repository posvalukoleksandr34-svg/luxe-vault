import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { ProductGridSkeleton } from '@/components/skeletons'
import { DEFAULT_LOCALE, UI, translate } from '@/lib/i18n'

/**
 * Shown while /catalog is being rendered on the server.
 *
 * It carries the Header and Footer because this page renders its own — without
 * them the chrome would vanish for the length of the fetch and slam back,
 * which is a worse flicker than the blank it replaces.
 *
 * A SERVER component, so it costs no JavaScript and paints with the first
 * byte. That is also why the label is read straight from the dictionary in the
 * default language rather than through the store: this renders before any
 * provider exists, and it is announced to a screen reader, not displayed.
 */
export default function CatalogLoading() {
  return (
    <>
      <Header />
      <main id="main">
        <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
          <div className="mb-10 h-9 w-48 animate-pulse bg-white/[0.06] sm:h-10" />
          <div className="flex flex-col lg:flex-row lg:items-start lg:gap-10">
            {/* The sticky sidebar's column, so the grid does not start
                full-width and then jump inwards when the real nav arrives. */}
            <div className="hidden w-56 shrink-0 space-y-3 lg:block">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 w-full animate-pulse bg-white/[0.06]" />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <ProductGridSkeleton count={8} label={translate(UI['state.loadingCatalog'], DEFAULT_LOCALE)} />
            </div>
          </div>
        </div>
        <Footer />
      </main>
    </>
  )
}
