import { NotFoundView } from '@/components/not-found-view'

/** The 404 for /it, /fr, /de: the same view, rendered inside the language segment. */
export default function LocaleNotFound() {
  return <NotFoundView kind="page" />
}
