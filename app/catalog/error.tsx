'use client'

import { CatalogUnavailable, type ErrorBoundaryProps } from '@/components/catalog-unavailable'

/**
 * The error boundary for /catalog: something under this segment threw while
 * rendering — typically the catalogue's database being unreachable.
 */
export default function CatalogError({ error, reset }: ErrorBoundaryProps) {
  return <CatalogUnavailable error={error} reset={reset} />
}
