import type { Metadata } from 'next'
import { NotFoundView } from '@/components/not-found-view'

// English, the default language; NotFoundView puts it into the visitor's
// language once loaded (lib/use-document-title.ts).
export const metadata: Metadata = { title: 'Page not found' }

/** Site-wide 404 — replaces Next's default English page. */
export default function NotFound() {
  return <NotFoundView kind="page" />
}
