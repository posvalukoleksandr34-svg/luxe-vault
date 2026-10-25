import type { Metadata } from 'next'
import { NotFoundView } from '@/components/not-found-view'

// English, the default language; NotFoundView puts it into the visitor's
// language once loaded (lib/use-document-title.ts).
export const metadata: Metadata = { title: 'Page not found' }

/** The 404 for /it, /fr, /de: the same view, rendered inside the language segment. */
export default function LocaleNotFound() {
  return <NotFoundView kind="page" />
}
