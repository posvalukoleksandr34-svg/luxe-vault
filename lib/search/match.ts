// Applies a reading (lib/search/interpret.ts) to the real catalogue.
//
// HARD filters — category, collection, colour, brand, price, "in stock" — are
// never loosened: "under €200" that returns a €300 jacket is a wrong answer.
// SOFT ones — leftover keywords, occasion, style, fit — are tried strictly
// first and then let go one at a time when nothing matches, and the result
// says which were let go so the search box can say so.
import { isProductBuyable } from '@/lib/availability'
import { colorFamiliesOf, resolveTags } from '@/lib/stylist/tagging'
import type { Product } from '@/lib/types'
import { normalizeText, type Interpretation } from './interpret'

export type RelaxedKind = 'keywords' | 'occasion' | 'style' | 'fit'
export type MatchResult = { products: Product[]; relaxed: RelaxedKind[] }

/** Everything a keyword may be found in, in every language. */
export function productHaystack(p: Product): string {
  const parts: string[] = [p.id, p.category, p.group, p.brand ?? '']
  for (const v of Object.values(p.name ?? {})) parts.push(String(v ?? ''))
  for (const v of Object.values(p.description ?? {})) parts.push(String(v ?? ''))
  for (const c of p.colors ?? []) parts.push(c.name)
  for (const s of p.specs ?? []) parts.push(s.label, s.value)
  return normalizeText(parts.join(' '))
}

export function matchProducts(products: Product[], reading: Interpretation): MatchResult {
  const f = reading.filters
  const categories = f.flatMap((x) => (x.kind === 'category' ? x.value : []))
  const groups = f.flatMap((x) => (x.kind === 'group' ? [x.value] : []))
  const colors = f.flatMap((x) => (x.kind === 'color' ? [x.value] : []))
  const brands = f.flatMap((x) => (x.kind === 'brand' ? [normalizeText(x.value)] : []))
  const fits = f.flatMap((x) => (x.kind === 'fit' ? [x.value] : []))
  const styles = f.flatMap((x) => (x.kind === 'style' ? [x.value] : []))
  const occasions = f.flatMap((x) => (x.kind === 'occasion' ? [x.value] : []))
  const maxes = f.flatMap((x) => (x.kind === 'maxPrice' ? [x.value] : []))
  const mins = f.flatMap((x) => (x.kind === 'minPrice' ? [x.value] : []))
  const max = maxes.length ? Math.min(...maxes) : null
  const min = mins.length ? Math.max(...mins) : null
  const inStock = f.some((x) => x.kind === 'inStock')

  const hard = products.filter((p) => {
    if ((categories.length || groups.length) && categories.indexOf(p.category) === -1 && groups.indexOf(p.group) === -1) {
      return false
    }
    if (colors.length) {
      const own = colorFamiliesOf(p)
      if (!colors.some((c) => own.indexOf(c) !== -1)) return false
    }
    if (brands.length && brands.indexOf(normalizeText(p.brand ?? '')) === -1) return false
    if (max !== null && p.price > max) return false
    if (min !== null && p.price < min) return false
    if (inStock && !isProductBuyable(p)) return false
    return true
  })

  const tags = new Map(hard.map((p) => [p.id, resolveTags(p)]))
  const hay = new Map(hard.map((p) => [p.id, productHaystack(p)]))
  const tests: { kind: RelaxedKind; test: (p: Product) => boolean }[] = []
  if (fits.length) tests.push({ kind: 'fit', test: (p) => fits.indexOf(tags.get(p.id)!.fit) !== -1 })
  if (styles.length) tests.push({ kind: 'style', test: (p) => styles.some((s) => tags.get(p.id)!.style.indexOf(s) !== -1) })
  if (occasions.length) {
    tests.push({ kind: 'occasion', test: (p) => occasions.some((o) => tags.get(p.id)!.occasion.indexOf(o) !== -1) })
  }
  if (reading.keywords.length) {
    tests.push({ kind: 'keywords', test: (p) => reading.keywords.every((k) => hay.get(p.id)!.indexOf(k) !== -1) })
  }

  // Something must still be asked of a product after loosening — a hard
  // filter or a soft one that held. Letting go of everything would answer
  // "pink ballgown" with the whole catalogue as its "closest pieces".
  const hardCount = categories.length + groups.length + colors.length + brands.length + maxes.length + mins.length + (inStock ? 1 : 0)
  let active = tests
  let result = hard.filter((p) => active.every((t) => t.test(p)))
  let relaxed: RelaxedKind[] = []
  for (const kind of ['keywords', 'occasion', 'style', 'fit'] as RelaxedKind[]) {
    if (result.length || !active.some((t) => t.kind === kind)) continue
    const next = active.filter((t) => t.kind !== kind)
    if (hardCount === 0 && next.length === 0) break
    active = next
    relaxed.push(kind)
    result = hard.filter((p) => active.every((t) => t.test(p)))
  }
  // Nothing found at all: nothing was "let go" in any useful sense.
  if (!result.length) relaxed = []

  // Buyable first, then the closest matches, then the catalogue's own order.
  const ranked = result
    .map((p, i) => ({ p, i, buy: isProductBuyable(p) ? 1 : 0, score: tests.filter((t) => t.test(p)).length }))
    .sort((a, b) => b.buy - a.buy || b.score - a.score || a.i - b.i)
    .map((x) => x.p)

  return { products: ranked, relaxed }
}
