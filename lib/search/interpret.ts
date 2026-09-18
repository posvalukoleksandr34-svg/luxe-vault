// Reading a search query the way a shopper means it — "black oversized jacket
// under €200" — into filters over the real catalogue.
//
// No model. A fixed vocabulary in the storefront's five languages, so it is
// instant, free, runs in the browser as well as on the server, and the same
// query always reads the same way. lib/server/search-ai.ts may add to it for
// phrasing these rules cannot place, but search never depends on that.
//
// Nothing here can invent anything: a category filter names a category the
// catalogue has, a brand filter a brand a product carries, a colour one of the
// families the stylist already maps the catalogue's colour names onto
// (lib/stylist/tagging.ts), and a price only one the query states.
import { getRates, type CurrencyCode } from '@/lib/currency'
import type { ColorFamily, Fit, Occasion, StyleKey } from '@/lib/stylist/types'
import type { LocalizedText, Product } from '@/lib/types'

type Named = { slug: string; names: string[] }

export type SearchContext = {
  categories: Named[]
  groups: Named[]
  brands: string[]
  /** What a bare "under 200" means: the visitor's display currency. */
  currency: CurrencyCode
}

/** One understood attribute. `phrase` is the query's own words for it, so the
 *  filter can be removed by taking those words out of the query. */
export type SearchFilter =
  | { kind: 'color'; value: ColorFamily; phrase: string }
  | { kind: 'fit'; value: Fit; phrase: string }
  | { kind: 'category'; value: string[]; phrase: string }
  | { kind: 'group'; value: string; phrase: string }
  | { kind: 'brand'; value: string; phrase: string }
  | { kind: 'style'; value: StyleKey; phrase: string }
  | { kind: 'occasion'; value: Occasion; phrase: string }
  | {
      kind: 'maxPrice' | 'minPrice'
      /** In CHF, the catalogue's currency. */
      value: number
      /** As the shopper wrote it, for the label. */
      amount: number
      currency: CurrencyCode
      phrase: string
    }
  | { kind: 'inStock'; value: true; phrase: string }

export type FilterKind = SearchFilter['kind']
export type Interpretation = { filters: SearchFilter[]; keywords: string[] }

/** Lower case, ё as е, one space: the form every rule and haystack uses. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const WORD = '\\p{L}\\p{N}'
/** Whole words only, in any script — `\b` does not know Cyrillic. The match's
 *  second group is the phrase itself. */
function bounded(src: string): RegExp {
  return new RegExp(`(^|[^${WORD}])(${src})(?=[^${WORD}]|$)`, 'iu')
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ------------------------------------------------------------ vocabulary --

const OCCASION_WORDS: [Occasion, string][] = [
  ['party', "night out|nights out|going out|evening out|party|parties|club|clubbing|вечеринк\\p{L}*|на выход|в клуб|festa|serata|soiree|soirée|sortie|ausgehen"],
  ['date', 'date night|date|свидани\\p{L}*|appuntamento|rendez-vous|rendez vous|verabredung'],
  ['work', 'work|office|business|работ\\p{L}*|офис\\p{L}*|lavoro|ufficio|bureau|travail|arbeit|büro|buero'],
  ['vacation', 'vacation|holidays?|beach|resort|отпуск\\p{L}*|пляж\\p{L}*|vacanz\\p{L}*|spiaggia|vacances|plage|urlaub|strand'],
  ['special', 'wedding|gala|special occasion|special event|ceremony|свадьб\\p{L}*|торжеств\\p{L}*|matrimonio|cerimonia|mariage|ceremonie|cérémonie|hochzeit'],
  ['study', 'school|university|campus|college|учеб\\p{L}*|универ\\p{L}*|школ\\p{L}*|scuola|universita|università|ecole|école|schule'],
  ['everyday', 'everyday wear|everyday|every day|daily|day-to-day|на каждый день|повседневн\\p{L}*|tutti i giorni|quotidian\\p{L}*|au quotidien|quotidien|alltag\\p{L}*|jeden tag'],
]

const STYLE_WORDS: [StyleKey, string][] = [
  ['old_money', 'old money|олд мани'],
  ['smart_casual', 'smart[- ]casual|смарт[- ]кэжуал'],
  ['streetwear', 'streetwear|street wear|street|стритвир|уличн\\p{L}*'],
  ['minimal', 'minimal\\p{L}*|минимал\\p{L}*|essential\\p{L}*|clean'],
  ['casual', 'casual|кэжуал|decontract\\p{L}*|décontract\\p{L}*|lassig|lässig'],
  ['luxury', 'luxury|luxurious|люкс\\p{L}*|lusso|luxus'],
  ['y2k', 'y2k'],
  ['sporty', 'sporty|sport|athletic|athleisure|спорт\\p{L}*|sportiv\\p{L}*|sportlich'],
]

const FIT_WORDS: [Fit, string][] = [
  ['oversized', 'oversized|oversize|over-size|boxy|baggy|relaxed(?: fit)?|loose(?: fit)?|оверсайз\\p{L}*|свободн\\p{L}*|ampi\\p{L}*|ample|weit\\p{L}*'],
  ['slim', 'slim(?: fit)?|skinny|fitted|приталенн\\p{L}*|облегающ\\p{L}*|aderent\\p{L}*|ajust\\p{L}*|schmal\\p{L}*|figurbetont'],
  ['regular', 'regular(?: fit)?|straight(?: fit)?|classic fit|прям\\p{L}* кро\\p{L}*|regolare|coupe droite|gerade'],
]

// Families in match order: "navy blue" must be read before "blue".
const COLOR_WORDS: [ColorFamily, string][] = [
  ['navy', 'navy blue|navy|bleu marine|blu navy|dunkelblau\\p{L}*|темно-син\\p{L}*|темно син\\p{L}*'],
  ['black', 'black|noir\\p{L}*|ner[oaie]|schwarz\\p{L}*|черн\\p{L}*'],
  ['white', 'white|off-white|blanc\\p{L}*|bianc\\p{L}*|weiss\\p{L}*|weiß\\p{L}*|бел(?:ый|ая|ое|ые|ого|ую|ых|ой)'],
  ['grey', 'grey|gray|gris\\p{L}*|grigi\\p{L}*|grau\\p{L}*|сер(?:ый|ая|ое|ые|ого|ую|ых|ой)'],
  ['beige', 'beige|бежев\\p{L}*'],
  ['brown', 'brown|marron|marrone|braun\\p{L}*|коричнев\\p{L}*'],
  ['green', 'green|olive|khaki|vert\\p{L}*|verde|verdi|grün\\p{L}*|gruen\\p{L}*|зелен\\p{L}*|хаки'],
  ['red', 'red|burgundy|rouge\\p{L}*|ross[oaie]|rot\\p{L}*|красн\\p{L}*|бордов\\p{L}*'],
  ['blue', 'blue|bleu\\p{L}*|blu|blau\\p{L}*|син(?:ий|яя|ее|ие|его|юю|их|ей)|голуб\\p{L}*'],
  ['pastel', 'pastel\\p{L}*|пастельн\\p{L}*'],
  ['bright', 'bright|neon|vivid|colou?rful|ярк\\p{L}*|accesi|vif|vive|knallig\\p{L}*'],
]

const IN_STOCK_WORDS =
  'in stock|available now|available|в наличии|есть в наличии|на складе|disponibil\\p{L}*|en stock|auf lager|verfügbar|verfugbar|lieferbar'

/** Everyday words for the shop's own category slugs. The catalogue's labels
 *  in all five languages are matched too (see buildSearchContext). */
const CATEGORY_WORDS: Record<string, string> = {
  jackets: 'jackets?|bombers?|outerwear|blousons?|куртк\\p{L}*|бомбер\\p{L}*|giacc\\p{L}*|giubbott\\p{L}*|vestes?|jacken?',
  hoodies: 'hoodies?|hoody|hooded sweatshirts?|sweatshirts?|худи|толстовк\\p{L}*|felp\\p{L}*|sweats?|kapuzenpullover',
  tshirts: 't-shirts?|tshirts?|t shirts?|tees?|футболк\\p{L}*|magliett\\p{L}*',
  pants: 'pants|trousers|брюк\\p{L}*|штан\\p{L}*|pantalon\\p{L}*|hosen?',
  sneakers: 'sneakers?|trainers?|кроссовк\\p{L}*|baskets?|turnschuh\\p{L}*',
  sneakers_low: 'low[- ]tops?|кед\\p{L}*',
  boots: 'boots?|ботин\\p{L}*|сапог\\p{L}*|stival\\p{L}*|bottes?|stiefel\\p{L}*',
  loafers: 'loafers?|лофер\\p{L}*|mocassin\\p{L}*',
  sandals: 'sandals?|slides|сандал\\p{L}*|шлепанц\\p{L}*|sandal\\p{L}*|claquettes',
  bags: 'bags?|handbags?|totes?|сумк\\p{L}*|borsa|borse|sacs?|taschen?',
  caps: 'caps?|кепк\\p{L}*|cappellin\\p{L}*|casquettes?|kappen?',
  hats: 'hats?|шляп\\p{L}*|cappello|cappelli|chapeaux?|hüte|hut',
  watches: 'watch|watches|часы|orolog\\p{L}*|montres?|uhren?',
  sunglasses: 'sunglasses|shades|очки|occhiali|lunettes|sonnenbrillen?',
  gloves: 'gloves?|перчатк\\p{L}*|guant\\p{L}*|gants|handschuh\\p{L}*',
}

const GROUP_WORDS: Record<string, string> = {
  clothing: 'clothing|clothes|apparel|одежд\\p{L}*|abbigliamento|vetements|vêtements|kleidung',
  shoes: 'shoes|footwear|обув\\p{L}*|scarpe|chaussures|schuhe',
  accessories: 'accessor(?:y|ies)|аксессуар\\p{L}*|accessori|accessoires',
}

// Price: "under €200", "до 200 €", "unter 200 CHF", "100–200 $", "от 100 до 300".
const CUR = "€|eur|euros?|евро|\\$|usd|dollars?|долл\\p{L}*|chf|sfr|franc\\p{L}*|франк\\p{L}*"
const AMT = `(?:(?:${CUR})\\s*)?\\d{1,6}(?:[.,]\\d{1,2})?\\s*(?:k|к|тыс\\.?)?(?:\\s*(?:${CUR}))?`
const MAX_WORDS =
  "under|below|less than|up to|cheaper than|max(?:imum)?|до|не дороже|дешевле|sotto|meno di|fino a|entro|sous|moins de|jusqu'a|jusqu'à|unter|bis|hochstens|höchstens|maximal"
const MIN_WORDS =
  'over|above|more than|at least|min(?:imum)?|от|дороже|sopra|piu di|più di|oltre|plus de|au moins|a partir de|à partir de|uber|über|ab|mindestens'

const RANGE_RE = bounded(`(?:between|from|от|entre|tra|zwischen|da)\\s+(${AMT})\\s+(?:and|to|до|et|à|a|e|und|bis)\\s+(${AMT})`)
const DASH_RANGE_RE = bounded(`(${AMT})\\s*[-–—]\\s*(${AMT})`)
const MAX_RE = bounded(`(?:${MAX_WORDS})\\s+(${AMT})`)
const MIN_RE = bounded(`(?:${MIN_WORDS})\\s+(${AMT})`)
const BARE_RE = bounded(`((?:${CUR})\\s*\\d{1,6}(?:[.,]\\d{1,2})?|\\d{1,6}(?:[.,]\\d{1,2})?\\s*(?:k|к)?\\s*(?:${CUR}))`)

/** Words that carry no product meaning of their own. */
const STOP = new Set(
  (
    "a an the for with and or in on of to at by my me i im i'm some something anything any wear wearing worn outfit outfits look looks style styles piece pieces item items new " +
    'для на и или в во с со к по под из мне что нибудь что-нибудь образ образа лук вещь вещи ' +
    'per con e o il la lo le gli un una uno di da del della dei delle ' +
    'pour avec et ou le la les un une des du de au aux ' +
    'für fur mit und oder der die das ein eine einen zum zur im am'
  ).split(' '),
)

const TRAILING_CONNECTOR = new RegExp('(^|\\s)(for|with|and|in|для|на|и|с|per|con|pour|avec|für|mit)\\s*$', 'iu')

function currencyOf(s: string): CurrencyCode | null {
  if (/€|eur|евро/i.test(s)) return 'EUR'
  if (/\$|usd|dollar|долл/i.test(s)) return 'USD'
  if (/chf|sfr|franc|франк/i.test(s)) return 'CHF'
  return null
}

function readAmount(s: string): { amount: number; currency: CurrencyCode | null } | null {
  const num = s.match(/\d{1,6}(?:[.,]\d{1,2})?/)
  if (!num) return null
  let amount = Number(num[0].replace(',', '.'))
  if (new RegExp('\\d\\s*(k|к|тыс)', 'iu').test(s)) amount *= 1000
  return amount > 0 ? { amount, currency: currencyOf(s) } : null
}

const toChf = (amount: number, currency: CurrencyCode) =>
  Math.round((amount / getRates()[currency]) * 100) / 100

// ------------------------------------------------------------- the reader --

export function interpretQuery(query: string, ctx: SearchContext): Interpretation {
  let rest = ` ${normalizeText(query)} `
  const filters: SearchFilter[] = []

  /** Finds a rule in what is left of the query and takes its words out, so
   *  nothing is read twice and the leftovers become plain keywords. */
  function take(re: RegExp): RegExpMatchArray | null {
    const m = rest.match(re)
    if (!m || m.index === undefined) return null
    const start = m.index + m[1].length
    rest = `${rest.slice(0, start)} ${rest.slice(start + m[2].length)}`
    return m
  }

  function price(kind: 'maxPrice' | 'minPrice', raw: string, phrase: string, currency?: CurrencyCode | null) {
    const a = readAmount(raw)
    if (!a) return
    const cur = a.currency ?? currency ?? ctx.currency
    filters.push({ kind, value: toChf(a.amount, cur), amount: a.amount, currency: cur, phrase: phrase.trim() })
  }

  // Price first — its words ("до", "over") would otherwise be read as
  // leftovers, and its numbers as nothing.
  let m = take(RANGE_RE)
  if (m) {
    const cur = currencyOf(m[3]) ?? currencyOf(m[4])
    price('minPrice', m[3], m[2], cur)
    price('maxPrice', m[4], m[2], cur)
  } else if ((m = rest.match(DASH_RANGE_RE)) && (currencyOf(m[3]) || currencyOf(m[4]))) {
    take(DASH_RANGE_RE)
    const cur = currencyOf(m[3]) ?? currencyOf(m[4])
    price('minPrice', m[3], m[2], cur)
    price('maxPrice', m[4], m[2], cur)
  } else {
    if ((m = take(MAX_RE))) price('maxPrice', m[3], m[2])
    if ((m = take(MIN_RE))) price('minPrice', m[3], m[2])
    // "jacket 200 €": a currency alongside a number reads as a budget.
    if (!filters.length && (m = take(BARE_RE))) price('maxPrice', m[3], m[2])
  }

  if ((m = take(bounded(IN_STOCK_WORDS)))) filters.push({ kind: 'inStock', value: true, phrase: m[2] })

  for (const [value, src] of OCCASION_WORDS) {
    if ((m = take(bounded(src)))) filters.push({ kind: 'occasion', value, phrase: m[2] })
  }
  for (const [value, src] of STYLE_WORDS) {
    if ((m = take(bounded(src)))) filters.push({ kind: 'style', value, phrase: m[2] })
  }
  for (const [value, src] of FIT_WORDS) {
    if ((m = take(bounded(src)))) {
      filters.push({ kind: 'fit', value, phrase: m[2] })
      break
    }
  }

  // Brands before categories: a brand named "Bag Studio" is a brand.
  const brands = ctx.brands.slice().sort((a, b) => b.length - a.length)
  for (const brand of brands) {
    if ((m = take(bounded(escapeRe(normalizeText(brand)))))) filters.push({ kind: 'brand', value: brand, phrase: m[2] })
  }

  const knownCategories = ctx.categories.map((c) => c.slug)
  for (const c of ctx.categories) {
    const words = [CATEGORY_WORDS[c.slug], ...c.names.map((n) => escapeRe(normalizeText(n)))].filter(Boolean)
    if (!words.length || !(m = take(bounded(words.join('|'))))) continue
    // "Sneakers" covers low-tops too when the shop has them.
    const value =
      c.slug === 'sneakers' && knownCategories.indexOf('sneakers_low') !== -1 ? ['sneakers', 'sneakers_low'] : [c.slug]
    filters.push({ kind: 'category', value, phrase: m[2] })
  }
  for (const g of ctx.groups) {
    const words = [GROUP_WORDS[g.slug], ...g.names.map((n) => escapeRe(normalizeText(n)))].filter(Boolean)
    if (words.length && (m = take(bounded(words.join('|'))))) filters.push({ kind: 'group', value: g.slug, phrase: m[2] })
  }

  for (const [value, src] of COLOR_WORDS) {
    if ((m = take(bounded(src)))) filters.push({ kind: 'color', value, phrase: m[2] })
  }

  const seen: string[] = []
  const keywords = rest
    .split(new RegExp(`[^${WORD}]+`, 'u'))
    .filter((w) => {
      if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w) || seen.indexOf(w) !== -1) return false
      seen.push(w)
      return true
    })

  return { filters, keywords }
}

/**
 * Whether the query asks for more than words in a name: a price, a fit, a
 * style, an occasion, availability or a brand — or three attributes at once.
 * "black jacket" alone stays with the keyword search, which ranks names.
 */
export function isSmartQuery(reading: Interpretation): boolean {
  const smart: FilterKind[] = ['maxPrice', 'minPrice', 'fit', 'style', 'occasion', 'inStock', 'brand']
  return reading.filters.some((f) => smart.indexOf(f.kind) !== -1) || reading.filters.length >= 3
}

/** Adds filters from another reader (the model), skipping any the rules
 *  already have, and drops the leftover keywords those filters explain. */
export function mergeFilters(base: Interpretation, extra: SearchFilter[]): Interpretation {
  const key = (f: SearchFilter) => `${f.kind}:${Array.isArray(f.value) ? f.value.join(',') : String(f.value)}`
  const have = base.filters.map(key)
  const hasPrice = (k: FilterKind) => base.filters.some((f) => f.kind === k)
  const added = extra.filter(
    (f) => have.indexOf(key(f)) === -1 && !((f.kind === 'maxPrice' || f.kind === 'minPrice') && hasPrice(f.kind)),
  )
  const phrases = added.map((f) => normalizeText(f.phrase))
  return {
    filters: [...base.filters, ...added],
    keywords: base.keywords.filter((k) => !phrases.some((p) => p.indexOf(k) !== -1)),
  }
}

/** The query without one filter's words — how a chip is removed. */
export function removePhrase(query: string, phrase: string): string {
  const pattern = escapeRe(normalizeText(phrase)).replace(/е/g, '[её]').replace(/ /g, '\\s+')
  let next = query.replace(new RegExp(pattern, 'iu'), ' ').replace(/\s+/g, ' ').trim()
  next = next.replace(TRAILING_CONNECTOR, '').trim()
  return next
}

/** The vocabulary a reading is made against: this catalogue's categories,
 *  collections and brands, with their names in every language. */
export function buildSearchContext(input: {
  products: Product[]
  categoryLabels: Record<string, LocalizedText | undefined>
  groupLabels: Record<string, LocalizedText | undefined>
  categorySlugs?: string[]
  groupSlugs?: string[]
  currency: CurrencyCode
}): SearchContext {
  const unique = (xs: string[]) => xs.filter((x, i) => x && xs.indexOf(x) === i)
  const names = (l?: LocalizedText) =>
    l ? Object.values(l).filter((v): v is string => typeof v === 'string' && v.trim().length > 1) : []
  const categories = unique([...(input.categorySlugs ?? []), ...input.products.map((p) => p.category)])
  const groups = unique([...(input.groupSlugs ?? []), ...input.products.map((p) => p.group)])
  return {
    categories: categories.map((slug) => ({ slug, names: names(input.categoryLabels[slug]) })),
    groups: groups.map((slug) => ({ slug, names: names(input.groupLabels[slug]) })),
    brands: unique(input.products.map((p) => p.brand?.trim() ?? '')),
    currency: input.currency,
  }
}
