import { NotFoundView } from '@/components/not-found-view'

/** Site-wide 404 — replaces Next's default English page. */
export default function NotFound() {
  return <NotFoundView kind="page" />
}
