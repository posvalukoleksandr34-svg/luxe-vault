import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

/**
 * Any address under a language that matches no page: /it/cart, /fr/old-link.
 *
 * Without this such a URL fell through to the ROOT 404, rendered outside the
 * language segment, so the server drew it in the default language and the
 * browser redrew it in the URL's — a flash of the wrong language. Rendered
 * here, inside the segment, it is in the URL's language on both sides.
 *
 * notFound() rather than rendering the 404 view: the status is a real 404
 * (no Suspense boundary above the pages any more — see app/layout.tsx), and
 * [locale]/not-found.tsx draws it in the URL's language.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

export default function MissingLocalePage() {
  notFound()
}
