'use client'

import './globals.css'

import { useEffect } from 'react'
import { UI } from '@/lib/i18n'

/**
 * Last-resort boundary for an error thrown by the ROOT LAYOUT itself — its
 * catalogue or shipping-settings read — which app/error.tsx cannot catch
 * because it renders inside that layout. Without this file Next shows its own
 * unstyled error page.
 *
 * It replaces the whole document, so it brings its own <html>/<body> and has
 * no StoreProvider: the copy is the storefront's own Russian (the site
 * default, <html lang="ru">) read straight from the i18n table, and the look
 * mirrors components/catalog-unavailable.tsx. "Try again" is a full reload,
 * because the layout that failed is server-rendered and reset() alone would
 * replay the same failed payload.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global error]', error.digest ?? '', error.message)
  }, [error])

  return (
    <html lang="ru" className="dark">
      <body className="font-sans">
        <main
          id="main"
          className="flex min-h-[100svh] w-full items-center justify-center bg-[#000000] px-6 py-16 text-[#CCCCCC]"
        >
          <div role="alert" className="flex max-w-md flex-col items-center text-center">
            <span aria-hidden className="h-px w-12 bg-[#D4AF37]/60" />
            <h1 className="mt-6 font-serif text-2xl tracking-wide text-[#CCCCCC] sm:text-3xl">
              {UI['state.catalogUnavailableTitle'].ru}
            </h1>
            <p className="mt-4 max-w-sm text-sm font-light leading-relaxed text-[#CCCCCC]">
              {UI['state.catalogUnavailableHint'].ru}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="tap-safe no-juice mt-10 inline-flex items-center justify-center border border-[#D4AF37] bg-transparent px-8 py-3 text-[11px] uppercase tracking-[0.2em] text-[#D4AF37] transition-colors duration-300 hover:bg-[#D4AF37] hover:text-[#000000] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 focus-visible:ring-offset-[#000000]"
            >
              {UI['common.retry'].ru}
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
