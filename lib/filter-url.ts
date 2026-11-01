import { EMPTY_FILTER, type Filter, type SortKey } from '@/lib/store'

/**
 * The filter, as a query string.
 *
 * Until now the filters lived in React state, which made every filtered view
 * unshareable and unlinkable: a customer who found "black jackets under 400,
 * newest first" could not send it to anyone, could not bookmark it, and lost
 * it the moment they hit back. The URL is where that state belongs — it is
 * the one piece of application state the browser already knows how to share,
 * restore and navigate.
 *
 * WHAT IS NOT HERE: `group` and `category`. Those are the ROUTE — the sidebar
 * navigates to /category/clothing/jackets rather than setting a filter — and
 * putting them in the query string as well would give the same listing two
 * addresses, which is the duplicate-content problem the canonical work exists
 * to avoid. They are filled in from the route by the page that renders the
 * grid, not from here.
 *
 * ONLY WHAT DIFFERS FROM THE DEFAULT IS WRITTEN. A cleared filter produces an
 * empty query string rather than `?sort=default&sale=false&…`, so the shop's
 * ordinary URLs stay clean and a shared link carries exactly the choices its
 * sender made.
 */

const SORT_KEYS: SortKey[] = ['default', 'newest', 'price_asc', 'price_desc', 'discount']

/** Bounds, so a hand-edited URL cannot ask for a million-franc minimum or a
 *  negative one and quietly render an empty grid. */
const PRICE_MAX = 1_000_000

function readPrice(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > PRICE_MAX) return null
  return Math.round(n * 100) / 100
}

/** A repeated or comma-separated list: ?size=M&size=L and ?size=M,L both work,
 *  because both are what people produce when they edit a URL by hand. */
function readList(params: URLSearchParams, key: string): string[] {
  const raw = params.getAll(key).flatMap((v) => v.split(','))
  const seen: string[] = []
  for (const item of raw) {
    const trimmed = item.trim()
    // Bounded: these are compared against catalogue values, and an unbounded
    // one would be a long string echoed back into the markup. De-duplicated,
    // so ?size=M&size=M does not filter twice or render two chips.
    if (trimmed && trimmed.length <= 40 && seen.indexOf(trimmed) === -1) seen.push(trimmed)
  }
  return seen.slice(0, 20)
}

/**
 * The filter a query string describes, merged onto the defaults.
 *
 * Unrecognised values are ignored rather than rejected: a shared link that
 * picked up a stale `sort=cheapest` should still show the shop, with the rest
 * of its filters intact, instead of an error page.
 */
export function filterFromParams(params: URLSearchParams, base: Filter = EMPTY_FILTER): Filter {
  const sort = params.get('sort') as SortKey | null

  return {
    ...base,
    sizes: readList(params, 'size'),
    colors: readList(params, 'color'),
    minPrice: readPrice(params.get('minPrice')),
    maxPrice: readPrice(params.get('maxPrice')),
    sale: params.get('sale') === '1' || params.get('view') === 'sale',
    inStockOnly: params.get('inStock') === '1',
    // `?view=new` is the address the newsletter's buttons point at, kept
    // working here rather than in a second effect that raced with this one.
    sort: sort && SORT_KEYS.indexOf(sort) !== -1 ? sort : params.get('view') === 'new' ? 'newest' : 'default',
  }
}

/**
 * The query string for a filter — only the parts that differ from the empty
 * one, in a fixed order so the same choices always produce the same URL.
 *
 * A stable order matters beyond tidiness: two URLs differing only in
 * parameter order are two URLs to a crawler and two cache entries to a CDN.
 */
export function filterToParams(filter: Filter): URLSearchParams {
  const params = new URLSearchParams()

  if (filter.sizes.length > 0) params.set('size', filter.sizes.join(','))
  if (filter.colors.length > 0) params.set('color', filter.colors.join(','))
  if (filter.minPrice !== null) params.set('minPrice', String(filter.minPrice))
  if (filter.maxPrice !== null) params.set('maxPrice', String(filter.maxPrice))
  if (filter.sale) params.set('sale', '1')
  if (filter.inStockOnly) params.set('inStock', '1')
  if (filter.sort !== 'default') params.set('sort', filter.sort)

  return params
}

/** True when two filters would produce the same URL. Used to decide whether a
 *  change is worth a history entry at all — without it, restoring the filter
 *  FROM the URL would immediately write it back and loop. */
export function sameFilterUrl(a: Filter, b: Filter): boolean {
  return filterToParams(a).toString() === filterToParams(b).toString()
}
