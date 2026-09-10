import 'server-only'

import { colorFamiliesOf, resolveTags } from '@/lib/stylist/tagging'
import { SLOTS } from '@/lib/stylist/types'
import type {
  Look,
  LookItem,
  Reason,
  Refinement,
  Slot,
  StylistBrief,
  StylistResult,
} from '@/lib/stylist/types'
import type { Product } from '@/lib/types'

/**
 * The recommendation engine.
 *
 * IT SELECTS; IT NEVER GENERATES. Every look is assembled by scoring rows that
 * came out of the catalogue and picking the best one per wardrobe slot. There
 * is no path through this file that can produce a product, a price, a size or
 * a colour that is not already in the database — which is the requirement that
 * ruled out asking a language model for the products themselves. A model can
 * describe a look (see rationale.ts); only this file decides what is in it.
 *
 * The scoring is deliberately transparent rather than clever: each signal adds
 * a bounded number of points, so a merchandiser can read why something placed
 * and tune it. Nothing here is trained or opaque.
 */

/** A buyable size for this customer, considering stock and their own sizes. */
function availableSizes(product: Product, wanted?: string[]): string[] {
  const tracked = (product.variants?.length ?? 0) > 0

  // Untracked products sell exactly as they did before inventory existed —
  // absent stock means "not counted", not "sold out". Same rule the grid and
  // the product page apply.
  const inStock = tracked
    ? product.sizes.filter((s) => product.variants!.some((v) => v.size === s && v.stock > 0))
    : product.sizes.slice()

  if (!wanted?.length) return inStock
  const overlap = inStock.filter((s) => wanted.indexOf(s) !== -1)
  // Their size is out of stock -> the piece is still shown, but the size they
  // asked for is not silently swapped. The caller decides how to present it.
  return overlap.length ? overlap : inStock
}

function isBuyable(product: Product): boolean {
  if (product.statuses.indexOf('out_of_stock') !== -1) return false
  if (!product.variants?.length) return true
  return product.variants.some((v) => v.stock > 0)
}

/** Score one product against the brief. Higher is better; 0 is "no signal". */
function scoreProduct(product: Product, brief: StylistBrief): { score: number; why: Reason[] } {
  const tags = resolveTags(product)
  // Typed reasons, never display strings. These reach the customer's screen
  // under each piece, and this file does not know which language that screen
  // is in — see Reason in lib/stylist/types.ts.
  const why: Reason[] = []
  let score = 0

  if (brief.style && brief.style !== 'open') {
    if (tags.style.indexOf(brief.style) !== -1) {
      score += 40
      why.push({ kind: 'style', key: brief.style })
    } else if (brief.style === 'oversized' && tags.fit === 'oversized') {
      score += 30
      why.push({ kind: 'fit', key: 'oversized' })
    }
  }

  if (brief.occasion && brief.occasion !== 'browsing') {
    if (tags.occasion.indexOf(brief.occasion) !== -1) {
      score += 25
      why.push({ kind: 'occasion', key: brief.occasion })
    }
  }

  if (brief.colors?.length) {
    const families = colorFamiliesOf(product)
    const hit = brief.colors.filter((c) => families.indexOf(c) !== -1)
    if (hit.length) {
      score += 25
      why.push({ kind: 'color', key: hit[0] })
    }
  }

  if (brief.sizes?.length) {
    const sizes = availableSizes(product, brief.sizes)
    if (brief.sizes.some((s) => sizes.indexOf(s) !== -1)) score += 20
  }

  // Free-text notes are matched as plain keywords against the product's own
  // words. Deliberately not an embedding: this must stay explainable, and a
  // shop this size has nothing to embed.
  if (brief.notes?.trim()) {
    const haystack = [
      Object.values(product.name ?? {}).join(' '),
      Object.values(product.description ?? {}).join(' '),
      product.brand ?? '',
      product.category,
    ]
      .join(' ')
      .toLowerCase()
    const words = brief.notes.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)
    const hits = words.filter((w) => haystack.indexOf(w) !== -1)
    if (hits.length) {
      score += Math.min(20, hits.length * 8)
      // The customer's own word, so it is shown as they typed it.
      why.push({ kind: 'text', text: hits[0] })
    }
  }

  // Gentle merchandising nudges, small enough never to outweigh the brief.
  if (product.isNew) score += 4
  if (product.oldPrice) score += 3

  return { score, why }
}

/** Up to three reasons for a piece, drawn only from attributes it really has. */
function reasonsFor(product: Product, why: Reason[]): Reason[] {
  const tags = resolveTags(product)
  const out: Reason[] = []
  if (tags.fit !== 'regular') out.push({ kind: 'fit', key: tags.fit })

  // The catalogue's own colour name ("Onyx") is product content, shown as the
  // admin wrote it — the same name the product page displays.
  const colour = product.colors[0]?.name
  if (colour) out.push({ kind: 'text', text: colour })

  // One matched reason. Skip any that would repeat the fit already shown: an
  // oversized piece matched on the "oversized" style would otherwise read
  // "Oversized · Onyx · Oversized".
  const repeatsFit = (r: Reason) =>
    tags.fit === 'oversized' &&
    (r.kind === 'fit' || (r.kind === 'style' && r.key === 'oversized'))
  const matched = why.filter((r) => !repeatsFit(r)).slice(0, 1)

  return out.concat(matched).slice(0, 3)
}

function toItem(product: Product, slot: Slot, brief: StylistBrief, score: number, why: Reason[]): LookItem {
  const sizes = availableSizes(product, brief.sizes)
  const preferred = brief.sizes?.find((s) => sizes.indexOf(s) !== -1)
  return {
    slot,
    product,
    availableSizes: sizes,
    suggestedSize: preferred ?? sizes[0] ?? null,
    suggestedColor: product.colors[0]?.name ?? '',
    reasons: reasonsFor(product, why),
    score,
  }
}

/**
 * Assembles the best look that fits a price ceiling.
 *
 * A BOUNDED EXACT SEARCH, not a greedy walk. The first version picked the
 * best-scoring piece per slot in order and, once the budget ran out, could not
 * go back and trade a dearer piece for a cheaper one. Measured on a test
 * catalogue: asked for a look under 250 it returned 290, having spent the
 * budget on a high-scoring bottom when a 220 combination existed. Respecting
 * the budget is the whole promise of the budget question, so the search now
 * considers every combination of the top few candidates per slot and takes the
 * highest-scoring one that actually fits.
 *
 * TOP_N keeps it cheap: 5 candidates across three required slots is 125
 * combinations, which is nothing, and a catalogue this size rarely has more
 * genuinely distinct options per slot anyway.
 */
const TOP_N = 5

type Candidate = { product: Product; score: number; why: Reason[] }

function assemble(
  ranked: Record<Slot, Candidate[]>,
  brief: StylistBrief,
  ceiling: number | null,
): { items: LookItem[]; total: number } {
  const required: Slot[] = ['top', 'bottom', 'shoes']
  const pools = required.map((slot) => ({ slot, list: ranked[slot].slice(0, TOP_N) }))

  // Slots the catalogue cannot fill at all are simply absent from the look;
  // the caller reports them as missing rather than substituting something.
  const usable = pools.filter((p) => p.list.length > 0)
  if (!usable.length) return { items: [], total: 0 }

  type Combo = { combo: Candidate[]; score: number; total: number }
  // Declared as a mutable holder rather than a bare `let`: TypeScript cannot
  // narrow a variable that is only ever assigned inside a closure, and reads
  // it as `never` after the null check below.
  const bestRef: { value: Combo | null } = { value: null }

  const walk = (depth: number, combo: Candidate[], score: number, total: number) => {
    if (depth === usable.length) {
      const fits = ceiling === null || total <= ceiling
      const current = bestRef.value
      // Prefer a fitting look always; among fitting looks prefer the highest
      // score; if nothing fits, keep the cheapest so the overrun is minimal
      // and can be reported honestly.
      const currentFits = current !== null && (ceiling === null || current.total <= ceiling)
      const better =
        current === null ||
        (fits && !currentFits) ||
        (fits === currentFits && (fits ? score > current.score : total < current.total))
      if (better) bestRef.value = { combo: combo.slice(), score, total }
      return
    }
    for (const candidate of usable[depth].list) {
      combo.push(candidate)
      walk(depth + 1, combo, score + candidate.score, total + candidate.product.price)
      combo.pop()
    }
  }
  walk(0, [], 0, 0)

  const best = bestRef.value
  if (!best) return { items: [], total: 0 }

  const chosen: { slot: Slot; candidate: Candidate }[] = best.combo.map(
    (c: Candidate, i: number) => ({ slot: usable[i].slot, candidate: c }),
  )
  let total = best.total

  // The accessory is optional and added last, only if it still fits. An
  // outfit without a cap is still an outfit; an outfit over budget is not
  // what was asked for.
  const accessory = ranked.accessory[0]
  if (accessory && (ceiling === null || total + accessory.product.price <= ceiling)) {
    chosen.push({ slot: 'accessory', candidate: accessory })
    total += accessory.product.price
  }

  const items = chosen.map(({ slot, candidate }) =>
    toItem(candidate.product, slot, brief, candidate.score, candidate.why),
  )
  return { items, total }
}

function rank(products: Product[], brief: StylistBrief) {
  const ranked: Record<Slot, { product: Product; score: number; why: Reason[] }[]> = {
    top: [],
    bottom: [],
    shoes: [],
    accessory: [],
  }
  for (const product of products) {
    // Sold-out pieces are EXCLUDED, not down-ranked. The first version gave
    // them a -60 penalty, which meant a catalogue where everything was out of
    // stock still returned a full look the customer could not buy a single
    // item of. A stylist that recommends the unavailable is worse than one
    // that says it has nothing.
    if (!isBuyable(product)) continue
    const slot = resolveTags(product).slot
    const { score, why } = scoreProduct(product, brief)
    ranked[slot].push({ product, score, why })
  }
  for (const slot of SLOTS) {
    ranked[slot].sort((a, b) => b.score - a.score || a.product.price - b.product.price)
  }
  return ranked
}

/** Applies a variation request to the brief without restarting the consultation. */
export function refineBrief(brief: StylistBrief, refinement: Refinement): StylistBrief {
  switch (refinement) {
    case 'more_minimal':
      return { ...brief, style: 'minimal' }
    case 'more_streetwear':
      return { ...brief, style: 'streetwear' }
    case 'cheaper':
      // Two thirds of whatever ceiling was in play, so "cheaper" means
      // something even when the customer never named a budget.
      return { ...brief, budget: Math.max(50, Math.round((brief.budget ?? 400) * 0.65)) }
    case 'more_premium':
      return { ...brief, budget: Math.round((brief.budget ?? 300) * 1.6) }
    case 'different_colors':
      return { ...brief, colors: undefined }
    case 'another':
    default:
      return brief
  }
}

/**
 * Builds the looks for a brief.
 *
 * `seed` rotates which candidate is taken first so "Try another" returns a
 * genuinely different look rather than the same one — without re-asking a
 * single question.
 */
export function buildLooks(
  products: Product[],
  brief: StylistBrief,
  seed = 0,
): StylistResult {
  const catalogSize = products.length

  // The anchor is the product page's "Style this piece": it is pinned into its
  // slot and everything else is chosen around it.
  const anchor = brief.anchorProductId
    ? products.find((p) => p.id === brief.anchorProductId)
    : undefined

  const ranked = rank(products, brief)

  // "Try another" walks DOWN the ranking by dropping the leaders it has
  // already shown, rather than rotating the list. Rotation did not work: the
  // exact search below re-finds the same optimum whatever order the pool is
  // in, so every press returned the identical look. Dropping candidates
  // changes the search space, which is the only thing that changes the answer.
  //
  // The pool is never emptied — a slot with one product keeps showing it,
  // because the alternative is a look with a hole in it.
  if (seed > 0) {
    for (const slot of SLOTS) {
      const list = ranked[slot]
      if (list.length > 1) {
        const drop = seed % list.length
        ranked[slot] = drop > 0 ? list.slice(drop) : list
      }
    }
  }

  if (anchor) {
    const slot = resolveTags(anchor).slot
    const entry = ranked[slot].find((c) => c.product.id === anchor.id)
    if (entry) ranked[slot] = [entry, ...ranked[slot].filter((c) => c.product.id !== anchor.id)]
  }

  const primary = assemble(ranked, brief, brief.budget ?? null)

  const relaxed: string[] = []
  if (brief.budget && primary.total > brief.budget) relaxed.push('budget')
  if (brief.sizes?.length) {
    const unmet = primary.items.some(
      (i) => !brief.sizes!.some((s) => i.availableSizes.indexOf(s) !== -1),
    )
    if (unmet) relaxed.push('size')
  }
  if (brief.colors?.length) {
    const unmet = primary.items.some((i) => {
      const fams = colorFamiliesOf(i.product)
      return !brief.colors!.some((c) => fams.indexOf(c) !== -1)
    })
    if (unmet) relaxed.push('colour')
  }

  const looks: Look[] = []
  if (primary.items.length) {
    looks.push({
      id: `look-${seed}-primary`,
      kind: 'primary',
      items: primary.items,
      total: primary.total,
      rationale: '',
      relaxed,
    })
  }

  // A premium alternative only when a budget was named AND the shop can
  // actually build something dearer. Offering a "step up" that is the same
  // look at the same price is noise.
  if (brief.budget && primary.items.length) {
    const premium = assemble(ranked, { ...brief, budget: undefined }, null)
    const differs = premium.items.some((p, i) => p.product.id !== primary.items[i]?.product.id)
    if (differs && premium.total > primary.total) {
      looks.push({
        id: `look-${seed}-premium`,
        kind: 'premium',
        items: premium.items,
        total: premium.total,
        rationale: '',
        relaxed: [],
      })
    }
  }

  const filled = new Set(primary.items.map((i) => i.slot))
  const missingSlots = SLOTS.filter((s) => s !== 'accessory' && !filled.has(s))

  return { looks, missingSlots, catalogSize, brief }
}
