/**
 * The catalogue's style vocabulary: the register, fit, occasion, season and
 * colour family a product can carry.
 *
 * Read by search (lib/search, lib/server/search-ai.ts), the product page, the
 * admin's product form and the fit advisor — in the browser and on the
 * server, so it must stay free of anything server-only.
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

/** The wardrobe slot a product fills (lib/style-tags/tagging.ts). */
export const SLOTS = ['top', 'bottom', 'shoes', 'accessory'] as const
export type Slot = (typeof SLOTS)[number]
