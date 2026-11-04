'use client'

import { useEffect } from 'react'
import { CatalogUnavailable, type ErrorBoundaryProps } from '@/components/catalog-unavailable'
import { CHUNK_ERROR_CONTEXT, isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-error'
import { reportError } from '@/lib/monitoring/reportError'

/**
 * The error boundary for /catalog: something under this segment threw while
 * rendering — typically the catalogue's database being unreachable. A chunk
 * that did not download is handled as in app/error.tsx: one reload, then a
 * connection message.
 */
export default function CatalogError({ error, reset }: ErrorBoundaryProps) {
  const chunk = isChunkLoadError(error)
  useEffect(() => {
    if (!chunk || reloadOnceForChunkError()) return
    reportError({ context: CHUNK_ERROR_CONTEXT, message: error.message, stack: error.stack, digest: error.digest })
  }, [error, chunk])
  return <CatalogUnavailable error={error} reset={reset} network={chunk} />
}
