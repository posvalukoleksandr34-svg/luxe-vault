import type { Product } from '@/lib/types'
import type { ColorFamily, Fit, Occasion, Season, Slot, StyleKey, StyleTags } from './types'

/**
 * Turning a catalogue row into something styleable.
 *
 * The stylist needs to know a product's register, fit, occasion and season.
 * `products.style_tags` holds those once an admin fills them in — but a shop
 * that has just installed this feature has tagged nothing, and a stylist that
 * returns "no matches" on day one is a stylist nobody switches on.
 *
 * So every product gets a DERIVED tag set from what the catalogue already
 * knows — its category, colours, name and price — and the admin's explicit
 * tags override it field by field. Nothing here invents a product; it only
 * reads attributes that are already on the row.
 */

/** Category slug -> wardrobe slot. The slugs are this shop's own. */
const SLOT_BY_CATEGORY: Record<string, Slot> = {
  hoodies: 'top',
  tshirts: 'top',
  jackets: 'top',
  shirts: 'top',
  knitwear: 'top',
  pants: 'bottom',
  jeans: 'bottom',
  shorts: 'bottom',
  skirts: 'bottom',
  cargo: 'bottom',
  sneakers: 'shoes',
  sneakers_low: 'shoes',
  boots: 'shoes',
  shoes: 'shoes',
  bags: 'accessory',
  caps: 'accessory',
  belts: 'accessory',
  jewellery: 'accessory',
  accessories: 'accessory',
}

/** Falls back to the collection when the category is unknown, so a product in
 *  a brand-new category still lands somewhere sensible. */
const SLOT_BY_COLLECTION: Record<string, Slot> = {
  clothing: 'top',
  shoes: 'shoes',
  accessories: 'accessory',
}

export function slotOf(product: Product): Slot {
  return (
    SLOT_BY_CATEGORY[product.category] ??
    SLOT_BY_COLLECTION[product.group] ??
    'accessory'
  )
}

/**
 * Maps a catalogue colour name onto a broad family.
 *
 * The shop names colours for the customer ("Onyx", "Bone"), and the
 * consultation asks in families ("black", "white"). Matching on substrings of
 * the lowercased name covers both the poetic names and the plain ones, in the
 * languages this catalogue actually uses.
 */
const COLOR_PATTERNS: [ColorFamily, RegExp][] = [
  ['black', /black|onyx|noir|jet|coal|чёрн|черн/i],
  ['white', /white|bone|ivory|cream|chalk|бел/i],
  ['grey', /grey|gray|graphite|charcoal|slate|ash|сер/i],
  ['beige', /beige|sand|taupe|camel|oat|ecru|бежев/i],
  ['brown', /brown|chocolate|espresso|tan|cognac|корич/i],
  ['navy', /navy|midnight|indigo|тёмно-син|темно-син/i],
  ['green', /green|olive|khaki|sage|forest|зелён|зелен|хаки/i],
  ['red', /red|burgundy|wine|crimson|bordeaux|красн|бордов/i],
  ['blue', /blue|azure|cobalt|denim|син|голуб/i],
  ['pastel', /pastel|lilac|mint|blush|powder|пастель/i],
  ['bright', /neon|bright|lime|fuchsia|orange|yellow|жёлт|оранж/i],
]

export function colorFamily(name: string): ColorFamily | null {
  for (const [family, re] of COLOR_PATTERNS) if (re.test(name)) return family
  return null
}

export function colorFamiliesOf(product: Product): ColorFamily[] {
  const out: ColorFamily[] = []
  for (const c of product.colors) {
    const f = colorFamily(c.name)
    if (f && out.indexOf(f) === -1) out.push(f)
  }
  return out
}

/** Style register inferred from the product's own words and shape. */
function deriveStyle(product: Product, slot: Slot): StyleKey[] {
  const text = [
    product.id,
    Object.values(product.name ?? {}).join(' '),
    Object.values(product.description ?? {}).join(' '),
    product.category,
  ]
    .join(' ')
    .toLowerCase()

  const styles: StyleKey[] = []
  const add = (s: StyleKey) => {
    if (styles.indexOf(s) === -1) styles.push(s)
  }
  if (/oversize|boxy|relaxed|baggy|оверсайз/.test(text)) add('oversized')
  if (/cargo|street|graphic|skate|hoodie|худи/.test(text)) add('streetwear')
  if (/minimal|clean|essential|plain|базов/.test(text)) add('minimal')
  if (/tailor|blazer|shirt|wool|cashmere|smart/.test(text)) add('smart_casual')
  if (/track|sport|running|active|спорт/.test(text)) add('sporty')
  if (/silk|leather|gold|couture|люкс/.test(text)) add('luxury')

  // Slot-level defaults, so nothing ends up with an empty register.
  if (styles.length === 0) add(slot === 'accessory' ? 'minimal' : 'casual')
  return styles
}

function deriveFit(product: Product): Fit {
  const text = Object.values(product.name ?? {}).join(' ').toLowerCase()
  if (/oversize|boxy|relaxed|baggy|wide|оверсайз/.test(text)) return 'oversized'
  if (/slim|skinny|fitted|tapered/.test(text)) return 'slim'
  return 'regular'
}

function deriveOccasion(slot: Slot, styles: StyleKey[]): Occasion[] {
  const out: Occasion[] = ['everyday']
  const add = (o: Occasion) => {
    if (out.indexOf(o) === -1) out.push(o)
  }
  if (styles.indexOf('smart_casual') !== -1 || styles.indexOf('luxury') !== -1) {
    add('work')
    add('special')
    add('date')
  }
  if (styles.indexOf('streetwear') !== -1 || styles.indexOf('oversized') !== -1) {
    add('study')
    add('party')
  }
  if (styles.indexOf('sporty') !== -1) add('study')
  if (slot === 'accessory') add('vacation')
  return out
}

function deriveSeason(product: Product): Season[] {
  const text = Object.values(product.name ?? {}).join(' ').toLowerCase()
  if (/coat|puffer|wool|knit|fleece|пух|шерст/.test(text)) return ['fall', 'winter']
  if (/linen|short|tank|swim|лён|лен/.test(text)) return ['spring', 'summer']
  return ['spring', 'summer', 'fall', 'winter']
}

/**
 * The tag set the engine scores against.
 *
 * Admin tags win field by field — a product tagged only with `fit` keeps its
 * derived style and occasion rather than losing them.
 */
export function resolveTags(product: Product): Required<StyleTags> & { slot: Slot } {
  const slot = slotOf(product)
  const explicit = (product.styleTags ?? {}) as StyleTags
  const style = explicit.style?.length ? explicit.style : deriveStyle(product, slot)
  return {
    slot,
    style,
    fit: explicit.fit ?? deriveFit(product),
    occasion: explicit.occasion?.length ? explicit.occasion : deriveOccasion(slot, style),
    season: explicit.season?.length ? explicit.season : deriveSeason(product),
  }
}
