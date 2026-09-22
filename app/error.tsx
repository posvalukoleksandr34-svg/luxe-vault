'use client'

import { useEffect } from 'react'
import { CatalogUnavailable, type ErrorBoundaryProps } from '@/components/catalog-unavailable'
import { reportError } from '@/lib/monitoring/reportError'

/**
 * The error boundary for every page: something threw while rendering —
 * typically the catalogue's database being unreachable.
 *
 * Rendered inside the root layout (and so inside StoreProvider), which is what
 * lets it speak the visitor's language.
 */
export default function PageError({ error, reset }: ErrorBoundaryProps) {
  // Once per error, not once per render: without the digest in the deps a
  // re-render of the boundary would file the same crash again.
  useEffect(() => {
    reportError({
      context: 'UI crash',
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    })
  }, [error])

  return <CatalogUnavailable error={error} reset={reset} />
}
