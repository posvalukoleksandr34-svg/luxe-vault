import type { Product } from '@/lib/types'

/**
 * The AI Stylist's shared vocabulary.
 *
 * Imported by both the browser (the consultation form) and the server (the
 * engine), so it must stay free of anything server-only.
 */

export const OCCASIONS = [
  'everyday',
  'date',
  'party',
  'study',
  'vacation',
  'work',
  'special',
  'browsing',
] as const

export const STYLES = [
  'streetwear',
  'minimal',
  'casual',
  'old_money',
  'luxury',
  'y2k',
  'oversized',
  'smart_casual',
  'sporty',
  'open',
] as const

export const FITS = ['oversized', 'regular', 'slim'] as const

export const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const

/** Broad colour families. Deliberately coarse: a customer picks "black", not
 *  "Onyx", and the engine maps the catalogue's own colour names onto these. */
export const COLOR_FAMILIES = [
  'black',
  'white',
  'grey',
  'beige',
  'brown',
  'navy',
  'green',
  'red',
  'blue',
  'pastel',
  'bright',
] as const

export type Occasion = (typeof OCCASIONS)[number]
export type StyleKey = (typeof STYLES)[number]
export type Fit = (typeof FITS)[number]
export type Season = (typeof SEASONS)[number]
export type ColorFamily = (typeof COLOR_FAMILIES)[number]

/** What the admin can store on a product. Every field optional — a partially
 *  tagged product is more useful than an untagged one. */
export type StyleTags = {
  style?: StyleKey[]
  fit?: Fit
  occasion?: Occasion[]
  season?: Season[]
}

/**
 * The consultation's answers.
 *
 * Every field is optional because every question is skippable — that is a
 * product requirement, not laziness. An empty brief is valid and yields the
 * shop's best-composed look rather than an error.
 */
export type StylistBrief = {
  occasion?: Occasion
  style?: StyleKey
  colors?: ColorFamily[]
  /** Upper bound for the WHOLE look, in the shop's currency. */
  budget?: number
  sizes?: string[]
  /** Free text: "I like wide-leg trousers", "something like Margiela". */
  notes?: string
  /** Product slug to build the look around — the product page's
   *  "Style this piece" entry point. */
  anchorProductId?: string
}

/** How a variation request modifies the brief without restarting it. */
export type Refinement =
  | 'another'
  | 'more_minimal'
  | 'more_streetwear'
  | 'cheaper'
  | 'more_premium'
  | 'different_colors'

/** The wardrobe slots a look is assembled from, in the order they are shown. */
export const SLOTS = ['top', 'bottom', 'shoes', 'accessory'] as const
export type Slot = (typeof SLOTS)[number]

export type LookItem = {
  slot: Slot
  product: Product
  /** The sizes this customer can actually buy, after stock and their own size
   *  filter — never the product's full size list. */
  availableSizes: string[]
  /** Pre-selected size: their preference when it is in stock, else the first
   *  available. Null when nothing is buyable. */
  suggestedSize: string | null
  suggestedColor: string
  /** Why this piece, in one clause. Composed from real attributes. */
  note: string
  score: number
}

export type Look = {
  id: string
  /** 'primary' is the in-budget answer; 'premium' is the optional step up. */
  kind: 'primary' | 'premium'
  items: LookItem[]
  total: number
  /** The prose shown under the look. */
  rationale: string
  /** Set when the engine had to loosen the brief to fill the look at all. */
  relaxed: string[]
}

export type StylistResult = {
  looks: Look[]
  /** Slots the catalogue simply cannot fill — surfaced to the customer rather
   *  than silently omitted, so a two-piece "outfit" is explained. */
  missingSlots: Slot[]
  /** How many products were considered. Lets the UI say something honest when
   *  the catalogue is too thin to style. */
  catalogSize: number
  brief: StylistBrief
}
