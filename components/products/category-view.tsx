'use client'

import { Suspense, useMemo } from 'react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { DepartmentFeatured } from '@/components/products/department-featured'
import { DepartmentHeader } from '@/components/products/department-header'
import { FilterUrlSync } from '@/components/products/filter-url-sync'
import { ProductGrid } from '@/components/products/product-grid'
import { useStore } from '@/lib/store'

/**
 * The body of a category route: trail, heading, left navigation, grid.
 *
 * ONE COMPONENT FOR EVERY DEPARTMENT. Women, Men and Kids are the same page
 * with a different `group`. It opens on a compact header (DepartmentHeader):
 * the department's name and its subcategories as one row, "All" first. The
 * department's own page lists every product in it; a subcategory page
 * (Women → Jackets) is the same page with that entry selected. Then the
 * toolbar and the grid, across the full width — no sidebar repeating Women /
 * Men / Kids, which the visitor has already chosen between. "Best sellers" /
 * "New in" / "On sale" (DepartmentFeatured, when the data backs them) follow
 * the grid on the department's own page, so the products come first.
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

      <DepartmentHeader group={group} category={category} />

      <div id="listing" className="scroll-mt-24">
        {/* The grid is what a category page is for: its first row is the
            LCP, so those photos load with priority. */}
        <ProductGrid lockedGroup={group} lockedCategory={category} wrap={false} eagerCount={4} />
      </div>

      {!category && (
        <div className="mt-16 lg:mt-20">
          <DepartmentFeatured group={group} />
        </div>
      )}
    </div>
  )
}
