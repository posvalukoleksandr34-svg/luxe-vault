'use client'

import { useMemo } from 'react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { CategoryNav } from '@/components/products/category-nav'
import { ProductGrid } from '@/components/products/product-grid'
import { useStore } from '@/lib/store'

/**
 * The body of a category route: trail, heading, left navigation, grid.
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
  const { t, localize, groupLabels, categoryLabels } = useStore()

  const groupLabel = localize(groupLabels[group] ?? {}) || group
  const categoryLabel = category ? localize(categoryLabels[category] ?? {}) || category : ''

  const trail = useMemo(
    () => [
      { name: t('nav.shop'), url: '/#shop' },
      { name: groupLabel, url: `/category/${group}` },
      ...(category ? [{ name: categoryLabel, url: `/category/${group}/${category}` }] : []),
    ],
    [t, groupLabel, categoryLabel, group, category],
  )

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <Breadcrumbs trail={trail} />

      <h1 className="mb-10 font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {category ? categoryLabel : groupLabel}
      </h1>

      {/* Column below `lg`, where CategoryNav renders its scrollable rail above
          the grid instead of a sidebar. From `lg`, a real two-column layout —
          `items-start` so the sticky sidebar has a taller parent to stick
          inside, because a stretched flex child cannot be sticky. */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:gap-10">
        <CategoryNav group={group} category={category} />

        {/* min-w-0: without it the grid's own content sets the flex basis and
            a long product name pushes the sidebar off-screen. */}
        <div className="min-w-0 flex-1">
          <ProductGrid lockedGroup={group} lockedCategory={category} wrap={false} />
        </div>
      </div>
    </div>
  )
}
