import { NextResponse, type NextRequest } from 'next/server'
import { readCatalog } from '@/lib/server/catalog-store'
import { enforceLimit } from '@/lib/server/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_RESULTS = 24
const MAX_POPULAR = 6

/**
 * Catalogue search.
 *
 * Ranking and typo tolerance happen in Postgres (see migration 0017); this
 * route turns the matched slugs back into the full products the storefront
 * already knows how to render, so the result cards are identical to the grid's
 * and nothing had to be duplicated.
 *
 * GET so it is cacheable, linkable and shows up in a browser's network tab as
 * what it is. Throttled because an unbounded search endpoint is a cheap way to
 * make the database work hard.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceLimit('search', request)
  if (limited) return limited

  const url = new URL(request.url)
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 60)

  // Below two characters every query matches almost everything, so the answer
  // is popular searches rather than a result set.
  if (query.length < 2) {
    return NextResponse.json({ results: [], fuzzy: false, popular: await popular() })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('search_products', {
    p_query: query,
    p_limit: MAX_RESULTS,
  })

  if (error) {
    // Migration 0017 not applied, or the RPC failed. Falling back to a
    // substring scan keeps the search box working — worse, but not broken.
    console.error('[search] search_products failed, falling back:', error.message)
    return NextResponse.json({
      results: await substringFallback(query),
      fuzzy: false,
      degraded: true,
      popular: [],
    })
  }

  const rows = (data ?? []) as { slug: string; rank: number; fuzzy: boolean }[]
  const { products } = await readCatalog()
  const bySlug = new Map(products.map((p) => [p.id, p]))

  // Postgres decided the order; preserving it is the whole point of ranking.
  const results = rows.map((r) => bySlug.get(r.slug)).filter(Boolean)

  // Counted only when something was found. A popular-searches list that
  // suggests queries returning nothing is worse than no list at all.
  if (results.length > 0) {
    void supabase.rpc('record_search', { p_term: query }).then(({ error: e }) => {
      if (e) console.warn('[search] could not record term:', e.message)
    })
  }

  return NextResponse.json({
    results,
    // True when every hit came from the spelling-tolerant fallback, which the
    // UI uses to say "showing results for…" rather than pretending it was an
    // exact match.
    fuzzy: rows.length > 0 && rows.every((r) => r.fuzzy),
    popular: results.length === 0 ? await popular() : [],
  })
}

async function popular(): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from('search_terms')
    .select('term')
    .order('hits', { ascending: false })
    .order('last_seen', { ascending: false })
    .limit(MAX_POPULAR)

  if (error) return []
  return (data ?? []).map((r) => r.term as string)
}

/** The pre-0017 behaviour, kept only as a safety net. */
async function substringFallback(query: string) {
  const { products } = await readCatalog()
  const q = query.toLowerCase()
  return products
    .filter((p) =>
      Object.values(p.name).some((n) => String(n).toLowerCase().includes(q)),
    )
    .slice(0, MAX_RESULTS)
}
