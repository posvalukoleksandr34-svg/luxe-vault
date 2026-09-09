import { NextResponse } from 'next/server'
import { readCatalog } from '@/lib/server/catalog-store'

// The catalogue changes whenever an admin edits it, and the storefront reads
// this on mount. Serving a build-time snapshot would reintroduce exactly the
// staleness this migration set out to fix — so the route itself stays dynamic
// and is never baked into the build.
export const dynamic = 'force-dynamic'

/**
 * How long a shared cache may serve this without asking again.
 *
 * StoreProvider calls this on mount on EVERY page view, so before this header
 * every visitor cost one full catalogue read from Postgres. That is the
 * single heaviest avoidable load the storefront puts on the database.
 *
 * 60s deliberately matches the root layout's `revalidate`, so the server-
 * rendered snapshot and the client's correction agree about how stale the
 * catalogue may be. Two different windows would mean the page could visibly
 * change a second after load for no reason the visitor can see.
 *
 * `stale-while-revalidate` lets the edge keep answering instantly for five
 * minutes past that while it refreshes underneath, so an admin edit costs one
 * slow request rather than a stampede of them.
 */
const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300'

/** Public catalogue: collections, categories and products in one payload. */
export async function GET() {
  try {
    const catalog = await readCatalog()
    return NextResponse.json(catalog, {
      headers: { 'Cache-Control': CACHE_CONTROL },
    })
  } catch (e) {
    console.error('[catalog] read failed:', e)
    // Never cached: a cached 500 would outlive the outage that caused it.
    return NextResponse.json(
      { error: 'Could not load catalogue' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
