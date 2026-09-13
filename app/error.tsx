'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { EmptyState } from '@/components/state-view'
import { useStore } from '@/lib/store'

/**
 * The error boundary for every page: something threw while rendering.
 *
 * Rendered inside the root layout (and so inside StoreProvider), which is what
 * lets it speak the visitor's language. It says what happened in one line,
 * reassures about the cart and orders — both live outside the page that
 * failed — and offers the two ways on: try again (re-render the segment), or
 * back to the catalogue. The error itself goes to the console only; no stack
 * trace on the page.
 */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useStore()

  useEffect(() => {
    console.error('[page error]', error.digest ?? '', error.message)
  }, [error])

  return (
    <main id="main" className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center justify-center px-6 py-16">
      <EmptyState
        role="alert"
        icon={AlertTriangle}
        title={t('state.errorTitle')}
        hint={t('state.errorHint')}
        action={{ label: t('common.retry'), onClick: reset, icon: RefreshCw }}
        secondary={{ label: t('state.goToCatalog'), href: '/#shop' }}
      />
    </main>
  )
}
