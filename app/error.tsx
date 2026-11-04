'use client'

import { useEffect } from 'react'
import { CatalogUnavailable, type ErrorBoundaryProps } from '@/components/catalog-unavailable'
import { CHUNK_ERROR_CONTEXT, isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-error'
import { reportError } from '@/lib/monitoring/reportError'

/**
 * The error boundary for every page: something threw while rendering —
 * typically the catalogue's database being unreachable.
 *
 * Rendered inside the root layout (and so inside StoreProvider), which is what
 * lets it speak the visitor's language.
 *
 * A chunk of the site's code that did not download (lib/chunk-error.ts) is
 * not a crash: the page reloads itself once, and only if that fails too does
 * the visitor see a connection message — and the owner a "chunk load" alert,
 * not a "UI crash".
 */
export default function PageError({ error, reset }: ErrorBoundaryProps) {
  const chunk = isChunkLoadError(error)

  // Once per error, not once per render: without the digest in the deps a
  // re-render of the boundary would file the same crash again.
  useEffect(() => {
    if (chunk) {
      if (reloadOnceForChunkError()) return
      reportError({ context: CHUNK_ERROR_CONTEXT, message: error.message, stack: error.stack, digest: error.digest })
      return
    }
    reportError({
      context: 'UI crash',
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    })
  }, [error, chunk])

  return <CatalogUnavailable error={error} reset={reset} network={chunk} />
}
