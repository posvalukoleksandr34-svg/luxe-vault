'use client'

import { Suspense, useMemo } from 'react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { CategoryNav } from '@/components/products/category-nav'
import { DepartmentFeatured } from '@/components/products/department-featured'
import { DepartmentHero } from '@/components/products/department-hero'
import { FilterUrlSync } from '@/components/products/filter-url-sync'
import { ProductGrid } from '@/components/products/product-grid'
import { SubcategoryCards, useHasSubcategoryCards } from '@/components/products/subcategory-cards'
import { useStore } from '@/lib/store'

/**
 * The body of a category route: trail, heading, left navigation, grid.
 *
 * ONE COMPONENT FOR EVERY DEPARTMENT. Women, Men and Kids are the same page
 * with a different `group`: on the department's own page it opens on the
 * department header (DepartmentHero), its subcategories as photo tiles,
 * "Best sellers" / "New in" / "On sale" when the data backs them
 * (DepartmentFeatured), then the toolbar and the grid. A subcategory page
 * (Women → Jackets) keeps a plain heading and goes straight to its products.
 *
 * Client-side because every label here is localised and the locale lives in
 * the store. It still renders in the initial HTML — Next server-renders client
 * components — so a crawler sees the heading and the trail in the site's
 * default locale, while a visitor who has switched language sees theirs. The
 * BreadcrumbList JSON-LD and the <title> stay on the server in that same
 * default locale, so the structured data has one canonical form.
 *
 * The slugs arrive as props from the route, which has already 404'd anything
 * unknown; nothing here re-validates them.
 */
export function CategoryView({ group, category }: { group: string; category?: string }) {
  const { t, localize, groupLabels, categoryLabel: labelOf } = useStore()

  const groupLabel = localize(groupLabels[group] ?? {}) || group
  const categoryLabel = category ? localize(labelOf(group, category)) || category : ''

  // Department pages with subcategories; on a subcategory page you have
  // already chosen.
  const hasCards = useHasSubcategoryCards(group)
  const cards = !category && hasCards

  const trail = useMemo(
    () => [
      { name: t('crumb.home'), url: '/' },
      { name: groupLabel, url: `/category/${group}` },
      ...(category ? [{ name: categoryLabel, url: `/category/${group}/${category}` }] : []),
    ],
    [t, groupLabel, categoryLabel, group, category],
  )

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      {/* See catalog-view: the filter is URL state, read inside a
          boundary of its own. */}
      <Suspense fallback={null}>
        <FilterUrlSync />
      </Suspense>

      <Breadcrumbs trail={trail} />

      {/* The department's own page opens on its header — the name, what it
          holds, the owner's text (0064) and a photograph; a subcategory page
          on a plain heading. */}
      {category ? (
        <h1 className="mb-8 font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:mb-10">
          {categoryLabel}
        </h1>
      ) : (
        <DepartmentHero group={group} />
      )}

      {/* A department page opens on where to go next: its subcategories as
          photo cards, above the sidebar, the filters and the grid. */}
      {cards && <SubcategoryCards group={group} />}

      {!category && <DepartmentFeatured group={group} />}

      {/* Column below `lg`, where CategoryNav renders its scrollable rail above
          the grid instead of a sidebar. From `lg`, a real two-column layout —
          `items-start` so the sticky sidebar has a taller parent to stick
          inside, because a stretched flex child cannot be sticky. */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:gap-10">
        {/* With the cards above, the phone rail of the same subcategories
            would be the same links twice in a row. */}
        <CategoryNav group={group} category={category} mobileRail={!cards} />

        {/* min-w-0: without it the grid's own content sets the flex basis and
            a long product name pushes the sidebar off-screen. */}
        <div id="listing" className="min-w-0 flex-1 scroll-mt-24">
          {/* The grid is what a category page opens on: its first row is
              the LCP, so those photos load with priority. */}
          <ProductGrid lockedGroup={group} lockedCategory={category} wrap={false} eagerCount={4} />
        </div>
      </div>
    </div>
  )
}
