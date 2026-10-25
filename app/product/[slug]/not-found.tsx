import type { Metadata } from 'next'
import { NotFoundView } from '@/components/not-found-view'

// English, the default language; NotFoundView puts it into the visitor's
// language once loaded (lib/use-document-title.ts).
export const metadata: Metadata = { title: 'This piece is no longer available' }

/**
 * A product slug with no product: almost always a piece that has been
 * removed from the catalogue since the link was shared. Said as such.
 */
export default function ProductNotFound() {
  return <NotFoundView kind="product" />
}
