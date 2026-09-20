'use client'

import { useMemo } from 'react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { useStore } from '@/lib/store'
import type { Product } from '@/lib/types'

/**
 * The product page's visible trail, in the visitor's language.
 *
 * The page is a server component and the language lives in the store, so the
 * trail it rendered was always the default locale — "SHOP › ОДЕЖДА › ХУДИ" on
 * an Italian page. Rendered here instead, exactly as CategoryView does for the
 * category routes. The BreadcrumbList JSON-LD stays on the server, in the
 * default locale, so the structured data keeps one canonical form.
 */
export function ProductTrail({ product }: { product: Product }) {
  const { t, localize, groupLabels, categoryLabels } = useStore()

  const trail = useMemo(
    () => [
      { name: t('nav.shop'), url: '/catalog' },
      ...(product.group
        ? [
            {
              name: localize(groupLabels[product.group] ?? {}) || product.group,
              url: `/category/${product.group}`,
            },
          ]
        : []),
      ...(product.group && product.category
        ? [
            {
              name: localize(categoryLabels[product.category] ?? {}) || product.category,
              url: `/category/${product.group}/${product.category}`,
            },
          ]
        : []),
      { name: localize(product.name), url: `/product/${product.id}` },
    ],
    [t, localize, groupLabels, categoryLabels, product],
  )

  return <Breadcrumbs trail={trail} />
}
