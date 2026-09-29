'use client'

import './globals.css'

import { useEffect } from 'react'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { defaultDictionary } from '@/lib/i18n-runtime'
import { reportError } from '@/lib/monitoring/reportError'

/**
 * Last-resort boundary for an error thrown by the ROOT LAYOUT itself — its
 * catalogue or shipping-settings read — which app/error.tsx cannot catch
 * because it renders inside that layout. Without this file Next shows its own
 * unstyled error page.
 *
 * It replaces the whole document, so it brings its own <html>/<body> and has
 * no StoreProvider — which means no visitor's chosen language either. The copy
 * is the storefront's DEFAULT language, from its bundled dictionary, and
 * the look mirrors components/catalog-unavailable.tsx. "Try again" is a full reload,
 * because the layout that failed is server-rendered and reset() alone would
 * replay the same failed payload.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global error]', error.digest ?? '', error.message)
    // The most serious crash the app has: the ROOT LAYOUT failed, so there is
    // no store, no chrome and no other boundary above this one. Reported under
    // its own context because it means every page is down, not one.
    reportError({
      context: 'Root layout crash',
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    })
  }, [error])

  return (
    <html lang={DEFAULT_LOCALE} className="dark">
      <body className="font-sans">
        <main
          id="main"
          className="flex min-h-[100svh] w-full items-center justify-center bg-background px-6 py-16 text-foreground/80"
        >
          <div role="alert" className="flex max-w-md flex-col items-center text-center">
            <span aria-hidden className="h-px w-12 bg-gold/60" />
            <h1 className="mt-6 font-serif text-2xl tracking-wide text-foreground/80 sm:text-3xl">
              {defaultDictionary['state.catalogUnavailableTitle']}
            </h1>
            <p className="mt-4 max-w-sm text-sm font-light leading-relaxed text-foreground/80">
              {defaultDictionary['state.catalogUnavailableHint']}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="tap-safe no-juice mt-10 inline-flex items-center justify-center rounded-xl border border-gold bg-transparent px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors duration-300 hover:bg-gold hover:text-gold-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {defaultDictionary['common.retry']}
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
