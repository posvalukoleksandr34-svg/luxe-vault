'use client'

import { CatalogUnavailable, type ErrorBoundaryProps } from '@/components/catalog-unavailable'

/**
 * The error boundary for every page: something threw while rendering —
 * typically the catalogue's database being unreachable.
 *
 * Rendered inside the root layout (and so inside StoreProvider), which is what
 * lets it speak the visitor's language.
 */
export default function PageError({ error, reset }: ErrorBoundaryProps) {
  return <CatalogUnavailable error={error} reset={reset} />
}
