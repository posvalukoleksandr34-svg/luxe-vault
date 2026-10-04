import type { Metadata } from 'next'
import { NotFoundView } from '@/components/not-found-view'

/**
 * Any address under a language that matches no page: /it/cart, /fr/old-link.
 *
 * Without this such a URL fell through to the ROOT 404, rendered outside the
 * language segment, so the server drew it in the default language and the
 * browser redrew it in the URL's — a flash of the wrong language. Rendered
 * here, inside the segment, it is in the URL's language on both sides.
 *
 * It renders the 404 view itself rather than calling notFound(). The root
 * layout wraps every page in a <Suspense> (see app/layout.tsx), and notFound()
 * thrown inside one cannot change the status code: Next answers 200 with a
 * noindex tag either way, and the boundary is dropped from the server HTML and
 * redrawn in the browser (React error #419 in the console). Rendering the view
 * directly gives the same status and the same noindex, with real server HTML
 * and no error. Switch back to notFound() — for a true 404 status — once that
 * boundary is gone.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

export default function MissingLocalePage() {
  return <NotFoundView kind="page" />
}
