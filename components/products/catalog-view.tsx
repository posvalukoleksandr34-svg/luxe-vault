'use client'

import { Suspense } from 'react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { FilterUrlSync } from '@/components/products/filter-url-sync'
import { CategoryNav } from '@/components/products/category-nav'
import { ProductGrid } from '@/components/products/product-grid'
import { useStore } from '@/lib/store'

/**
 * /catalog — the whole shop, with the same sidebar and grid a department page
 * uses.
 *
 * It exists so that choosing a department never lands on the homepage: a card
 * whose department has its own collection goes straight to /category/<slug>,
 * and one that does not yet comes here instead of scrolling the homepage to
 * an anchor. Either way the next screen is the catalogue, not a stop on the
 * way to it.
 *
 * No `lockedGroup`: the sidebar lists every department, and picking one is a
 * real navigation to its own page — the URL always says what is on screen, so
 * it can be shared, crawled and reached with the back button.
 */
export function CatalogView() {
  const { t } = useStore()

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      {/* The filter lives in the address bar. Suspended because it reads
          searchParams, which would otherwise opt this whole route out of
          static rendering — see the note in the component. */}
      <Suspense fallback={null}>
        <FilterUrlSync />
      </Suspense>

      <Breadcrumbs trail={[{ name: t('tab.catalog'), url: '/catalog' }]} />

      <h1 className="mb-10 font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {t('tab.catalog')}
      </h1>

      {/* Column on a phone — the sidebar becomes the department rail above the
          grid — and a real two-column layout from lg. `items-start` so the
          sticky sidebar has a taller parent to stick inside: a stretched flex
          child cannot be sticky. */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:gap-10">
        <CategoryNav />

        {/* min-w-0: without it a long product name sets the flex basis and
            pushes the sidebar off-screen. */}
        <div className="min-w-0 flex-1">
          {/* The sidebar is the taxonomy here, so the grid's own department
              and category chips are hidden; sort and availability stay. */}
          <ProductGrid wrap={false} eagerCount={4} hideTaxonomyChips />
        </div>
      </div>
    </div>
  )
}
