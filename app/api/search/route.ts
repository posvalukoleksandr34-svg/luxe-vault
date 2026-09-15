import { NextResponse, type NextRequest } from 'next/server'
import { isCurrencyCode, type CurrencyCode } from '@/lib/currency'
import { CATEGORY_LABELS, GROUP_LABELS } from '@/lib/i18n'
import { buildSearchContext, interpretQuery, isSmartQuery, mergeFilters } from '@/lib/search/interpret'
import { matchProducts } from '@/lib/search/match'
import { readCatalog } from '@/lib/server/catalog-store'
import { enforceLimit } from '@/lib/server/rate-limit'
import { interpretWithAi, isSearchAiConfigured } from '@/lib/server/search-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import type { LocalizedText, Product } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_RESULTS = 24
const MAX_POPULAR = 6

/**
 * Catalogue search.
 *
 * Two readings of one box:
 *
 *  - KEYWORD — "black jacket", "margiela". Ranking and typo tolerance happen
 *    in Postgres (migration 0017), exactly as before.
 *  - SMART — "black oversized jacket under €200". The query is read into
 *    filters (colour, fit, category, brand, style, occasion, price,
 *    availability) by lib/search/interpret.ts and applied to the real
 *    catalogue (lib/search/match.ts). Used when the query asks for more than
 *    words in a name, or when the keyword search finds nothing but the query
 *    names attributes it can read.
 *
 * A model (lib/server/search-ai.ts) is consulted only when the client asks
 * for it (`ai=1`, sent once typing has settled) and the rules left words they
 * could not place. If it fails, is slow, or is not configured, the rules'
 * reading stands. Every result is a real product from the catalogue.
 *
 * GET so it is cacheable, linkable and shows up in a browser's network tab as
 * what it is. Throttled because an unbounded search endpoint is a cheap way to
 * make the database work hard.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceLimit('search', request)
  if (limited) return limited

  const url = new URL(request.url)
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
  const cur = url.searchParams.get('cur')
  const currency: CurrencyCode = isCurrencyCode(cur) ? cur : 'CHF'
  const wantAi = url.searchParams.get('ai') === '1'

  // Below two characters every query matches almost everything, so the answer
  // is popular searches rather than a result set.
  if (query.length < 2) {
    return NextResponse.json({ results: [], fuzzy: false, popular: await popular() })
  }

  const catalog = await readCatalog()
  const categoryLabels: Record<string, LocalizedText | undefined> = { ...CATEGORY_LABELS }
  for (const c of catalog.categories) categoryLabels[c.slug] = c.name
  const groupLabels: Record<string, LocalizedText | undefined> = { ...GROUP_LABELS }
  for (const g of catalog.collections) groupLabels[g.slug] = g.name

  const ctx = buildSearchContext({
    products: catalog.products,
    categoryLabels,
    groupLabels,
    categorySlugs: catalog.categories.map((c) => c.slug),
    groupSlugs: catalog.collections.map((g) => g.slug),
    currency,
  })
  let reading = interpretQuery(query, ctx)

  // Plain queries keep the keyword search — it ranks names better than
  // attributes can.
  if (!isSmartQuery(reading)) {
    const keyword = await keywordSearch(query.slice(0, 60), catalog.products)
    if (keyword.results.length > 0 || (reading.filters.length === 0 && !aiEligible(query, reading))) {
      if (keyword.results.length > 0) recordSearch(query)
      return NextResponse.json({
        results: keyword.results,
        total: keyword.results.length,
        fuzzy: keyword.fuzzy,
        degraded: keyword.degraded || undefined,
        mode: 'keyword',
        popular: keyword.results.length === 0 ? await popular() : [],
      })
    }
  }

  const eligible = aiEligible(query, reading)
  let ai = false
  if (wantAi && eligible) {
    const extra = await interpretWithAi(query, ctx)
    if (extra?.length) {
      reading = mergeFilters(reading, extra)
      ai = true
    }
  }

  const { products: matched, relaxed } = matchProducts(catalog.products, reading)
  const results = matched.slice(0, MAX_RESULTS)
  if (results.length > 0) recordSearch(query)

  return NextResponse.json({
    results,
    total: matched.length,
    fuzzy: false,
    mode: 'smart',
    interpretation: { filters: reading.filters, keywords: reading.keywords, relaxed, ai },
    // Tells the client a second, model-assisted reading may help — asked for
    // only once typing has settled, so typing never waits on it.
    aiEligible: !wantAi && eligible,
    popular: results.length === 0 ? await popular() : [],
  })
}

/** Worth a model's reading: configured, a phrase rather than a word, and
 *  words the rules could not place. */
function aiEligible(query: string, reading: { keywords: string[] }): boolean {
  return isSearchAiConfigured() && reading.keywords.length > 0 && query.split(/\s+/).length >= 3
}

async function keywordSearch(
  query: string,
  products: Product[],
): Promise<{ results: Product[]; fuzzy: boolean; degraded: boolean }> {
  const { data, error } = await createAdminClient().rpc('search_products', {
    p_query: query,
    p_limit: MAX_RESULTS,
  })

  if (error) {
    // Migration 0017 not applied, or the RPC failed. Falling back to a
    // substring scan keeps the search box working — worse, but not broken.
    console.error('[search] search_products failed, falling back:', error.message)
    return { results: substringFallback(query, products), fuzzy: false, degraded: true }
  }

  const rows = (data ?? []) as { slug: string; rank: number; fuzzy: boolean }[]
  const bySlug = new Map(products.map((p) => [p.id, p]))
  // Postgres decided the order; preserving it is the whole point of ranking.
  const results = rows.map((r) => bySlug.get(r.slug)).filter((p): p is Product => Boolean(p))
  // True when every hit came from the spelling-tolerant fallback, which the UI
  // uses to say "showing closest matches" rather than pretend it was exact.
  return { results, fuzzy: rows.length > 0 && rows.every((r) => r.fuzzy), degraded: false }
}

/** Counted only when something was found. A popular-searches list that
 *  suggests queries returning nothing is worse than no list at all.
 *
 *  Production only: a development server talks to the same database, and a
 *  developer's test phrases must not become customers' "popular searches". */
function recordSearch(query: string) {
  if (process.env.NODE_ENV !== 'production') return
  void createAdminClient()
    .rpc('record_search', { p_term: query.slice(0, 60) })
    .then(({ error }) => {
      if (error) console.warn('[search] could not record term:', error.message)
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
function substringFallback(query: string, products: Product[]) {
  const q = query.toLowerCase()
  return products
    .filter((p) => Object.values(p.name).some((n) => String(n).toLowerCase().includes(q)))
    .slice(0, MAX_RESULTS)
}
