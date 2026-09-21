'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { filterFromParams, filterToParams, sameFilterUrl } from '@/lib/filter-url'
import { useStore } from '@/lib/store'

/**
 * Keeps the product filter and the address bar saying the same thing.
 *
 * Renders nothing. It exists so that a filtered listing has an address: one
 * that can be shared, bookmarked, reopened, and walked back through with the
 * browser's own back button — none of which worked while the filter was React
 * state.
 *
 * WHY IT IS ITS OWN COMPONENT, AND WHY IT IS WRAPPED IN <Suspense>.
 * `useSearchParams()` opts its nearest Suspense boundary out of static
 * rendering. Putting it in the store provider, which the root layout mounts,
 * would have taken every page in the shop dynamic — the opposite of the work
 * that got the storefront prerendering in four languages. Confined here and
 * suspended by its caller, the cost is one small boundary on the two pages
 * that actually have filters.
 *
 * TWO DIRECTIONS, ONE LOOP TO AVOID. The URL leads on arrival and on
 * navigation; the controls lead while someone is using them. `sameFilterUrl`
 * is what keeps those from chasing each other: neither side writes when the
 * two already agree, so restoring a filter from the URL does not immediately
 * write it back.
 */
export function FilterUrlSync() {
  const { filter, setFilter } = useStore()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const search = searchParams?.toString() ?? ''

  // The last URL this component itself wrote. A change that matches it is our
  // own echo arriving back through the router, not a navigation to react to.
  const written = useRef<string | null>(null)

  // URL → filter. Runs on arrival and on every back/forward step, so the grid
  // always shows what the address says it shows.
  useEffect(() => {
    if (written.current === search) return
    const fromUrl = filterFromParams(new URLSearchParams(search), filter)
    if (!sameFilterUrl(fromUrl, filter)) setFilter(fromUrl)
    // `filter` is deliberately not a dependency: this effect is about the URL
    // changing, and including it would run the restore on every control click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, setFilter])

  // Filter → URL, with replace() rather than push(): dragging a price slider
  // must not bury the previous page under thirty history entries. The choices
  // are still in the address to copy, and back still leaves the listing.
  useEffect(() => {
    const next = filterToParams(filter).toString()
    if (next === search) {
      written.current = next
      return
    }
    written.current = next
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
  }, [filter, search, pathname, router])

  return null
}
