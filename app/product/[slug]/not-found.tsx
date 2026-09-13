import { NotFoundView } from '@/components/not-found-view'

/**
 * A product slug with no product: almost always a piece that has been
 * removed from the catalogue since the link was shared. Said as such.
 */
export default function ProductNotFound() {
  return <NotFoundView kind="product" />
}
