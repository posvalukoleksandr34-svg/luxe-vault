/**
 * Size recommendation from the shopper's own information and this product's
 * cut.
 *
 * Deterministic and client-side: no model, no network, the same inputs always
 * give the same answer. Kept in lib/ rather than inside the modal so the rule
 * can be read, tested and tuned without touching any UI.
 *
 * WHAT THIS IS, HONESTLY. Height and weight are a proxy for chest and length,
 * not a measurement of them, and a usual size varies from brand to brand. So
 * the result carries a confidence, the modal says it is an estimate, and the
 * product's real measurements — when it has them — are shown beside it.
 */

export const LETTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const
export type LetterSize = (typeof LETTER_SIZES)[number]
export type FitPreference = 'slim' | 'regular' | 'oversized'
export type Confidence = 'high' | 'medium' | 'low'

/** Which measurements matter, and which run the product is sold in. */
export type FitCategory = 'tops' | 'bottoms' | 'shoes'

/**
 * Used to weigh the optional measurements, not to shift the size on its own.
 * Nudging every woman a size in one direction would be guesswork about a
 * garment whose own cut we already read from `productCut`; what gender does
 * change is which measurement leads on bottoms — hips or waist.
 */
export type Gender = 'female' | 'male' | 'unspecified'

/** Morphology, as the shopper describes it. Shifts the size by a fraction,
 *  because two people of one height and weight do not wear one size. */
export type BodyType = 'slim' | 'average' | 'athletic' | 'broad'

/** Foot width, for the shoe run. */
export type FootWidth = 'narrow' | 'regular' | 'wide'

export type FitInput = {
  heightCm?: number
  weightKg?: number
  /** The size they usually wear in an ordinary cut. Enough on its own. */
  usualSize?: LetterSize
  preference: FitPreference
  /** How THIS product is cut — the admin's fit tag, or read from its name
   *  (lib/style-tags/tagging.ts). Regular when unknown. */
  productCut?: FitPreference

  // --- optional, and worth more than height and weight when present -------
  gender?: Gender
  bodyType?: BodyType
  /** Body measurements in CENTIMETRES, always: the imperial toggle converts
   *  on the way in, so everything below this line is one unit. */
  chestCm?: number
  waistCm?: number
  hipsCm?: number
  /** Bottoms. */
  inseamCm?: number
  /** Shoes. */
  footLengthCm?: number
  footWidth?: FootWidth
}

// ------------------------------------------------------------------ units --

export const CM_PER_INCH = 2.54
export const KG_PER_LB = 0.45359237

/**
 * The finder works in centimetres and kilograms only. These two remain for
 * one job: converting a measurement saved while the component briefly offered
 * inches and pounds, so an old payload is read back as the body it described.
 */
export const toCm = (inches: number): number => inches * CM_PER_INCH
export const toKg = (lb: number): number => lb * KG_PER_LB

/** Rounds for display: lengths to the nearest half unit, weights to whole. */
export const round1 = (n: number): number => Math.round(n * 2) / 2

/**
 * Which fields to ask for, from the product's own place in the catalogue.
 * Anything else — a cap, a bag — gets no advisor at all.
 */
export function fitCategoryOf(group: string | undefined, category: string | undefined): FitCategory | null {
  const g = (group ?? '').toLowerCase()
  const c = (category ?? '').toLowerCase()
  if (g === 'shoes' || /sneaker|boot|loafer|sandal|shoe/.test(c)) return 'shoes'
  if (/pant|trouser|jean|short|skirt|legging|chino/.test(c)) return 'bottoms'
  if (g === 'clothing' || /hoodie|shirt|jacket|coat|sweater|dress|top/.test(c)) return 'tops'
  return null
}

export type FitRecommendation = {
  /** Where the shopper's information points, before looking at what this
   *  product has in stock. */
  size: LetterSize
  /** The continuous index behind it (0 = XS … 5 = XXL), kept for transparency. */
  score: number
  confidence: Confidence
  /** Which information it rests on. */
  basis: 'body' | 'usual' | 'both'
}

/** Adult ranges the table is meaningful for. Outside them we do not guess. */
export const HEIGHT_RANGE = { min: 140, max: 220 } as const
export const WEIGHT_RANGE = { min: 35, max: 200 } as const

const given = (n: number | undefined): n is number => typeof n === 'number' && !Number.isNaN(n)

/**
 * 'missing' — neither a usual size nor height AND weight (one without the
 * other says nothing); 'range' — numbers outside the adult table.
 */
export function checkFitInput(input: FitInput): 'ok' | 'missing' | 'range' {
  const hasHeight = given(input.heightCm)
  const hasWeight = given(input.weightKg)
  if (!hasHeight && !hasWeight) return input.usualSize ? 'ok' : 'missing'
  if (hasHeight !== hasWeight) return 'missing'
  const h = input.heightCm as number
  const w = input.weightKg as number
  return h >= HEIGHT_RANGE.min && h <= HEIGHT_RANGE.max && w >= WEIGHT_RANGE.min && w <= WEIGHT_RANGE.max
    ? 'ok'
    : 'range'
}

/** True when the product is sold in letter sizes — the only run this table
 *  describes. Shoes (41, 42…) and one-size caps get no advisor at all. */
export function isLetterSizeRun(sizes: string[]): boolean {
  return sizes.length > 0 && sizes.every((s) => indexOf(s) !== -1)
}

/** Position in the letter run, or -1. "2XL" and "XXL" are one size written
 *  two ways, as are "3XL" and "XXXL" — catalogues use both. */
export function indexOfSize(size: string): number {
  const s = size.trim().toUpperCase().replace(/^2XL$/, 'XXL').replace(/^3XL$/, 'XXXL')
  return (LETTER_SIZES as readonly string[]).indexOf(s)
}

const indexOf = indexOfSize

/**
 * BMI anchors -> size index, interpolated linearly between them.
 *
 * A ratio of weight to height squared is what separates "tall and slim" from
 * "short and broad", which raw weight alone cannot. The anchors are the usual
 * ready-to-wear breakpoints; everything between two anchors lands between two
 * sizes, which is what the confidence reports.
 */
const BMI_ANCHORS: [bmi: number, index: number][] = [
  [17, 0], // XS
  [19.5, 1], // S
  [22, 2], // M
  [24.5, 3], // L
  [27, 4], // XL
  [30, 5], // XXL
  [33, 6], // XXXL
]

function bmiToIndex(bmi: number): number {
  const first = BMI_ANCHORS[0]
  const last = BMI_ANCHORS[BMI_ANCHORS.length - 1]
  if (bmi <= first[0]) return first[1]
  if (bmi >= last[0]) return last[1]
  for (let i = 1; i < BMI_ANCHORS.length; i++) {
    const [b1, s1] = BMI_ANCHORS[i]
    if (bmi <= b1) {
      const [b0, s0] = BMI_ANCHORS[i - 1]
      return s0 + ((bmi - b0) / (b1 - b0)) * (s1 - s0)
    }
  }
  return last[1]
}

/**
 * How the wanted fit moves the size, given how the piece itself is cut.
 *
 * A regular cut: oversized is a whole size up — that is what the look is —
 * and slim only a nudge down, tipping someone between two sizes into the
 * smaller one but never taking a squarely-M person to an S (a garment that
 * does not close is a return, not a fit).
 *
 * A piece cut oversized already carries the volume: the oversized look is
 * the usual size, a regular fit one down. A piece cut slim runs close: a
 * regular fit tips up when between sizes, oversized goes a size and a half.
 */
const SHIFT: Record<FitPreference, Record<FitPreference, number>> = {
  regular: { slim: -0.35, regular: 0, oversized: 1 },
  oversized: { slim: -1.35, regular: -1, oversized: 0 },
  slim: { slim: 0, regular: 0.4, oversized: 1.5 },
}

export function recommendSize(input: FitInput): FitRecommendation {
  let body: number | null = null
  let bmi = 0
  if (given(input.heightCm) && given(input.weightKg)) {
    const meters = input.heightCm / 100
    bmi = input.weightKg / (meters * meters)
    body = bmiToIndex(bmi)
    // Length. A tall frame runs out of sleeve and hem before it runs out of
    // chest, so height pushes the size up, and a short frame the other way.
    // Half a size per 8 cm beyond the band, capped at one size either way.
    if (input.heightCm >= 180) body += Math.min(1, (input.heightCm - 180) / 16)
    else if (input.heightCm <= 166) body -= Math.min(1, (166 - input.heightCm) / 16)
  }
  // Morphology: the same height and weight sit on different frames. Held to
  // well under a size, because it is a self-description, not a measurement.
  const MORPHOLOGY: Record<BodyType, number> = { slim: -0.3, average: 0, athletic: 0.3, broad: 0.6 }
  if (body !== null && input.bodyType) body += MORPHOLOGY[input.bodyType]

  const usual = input.usualSize ? indexOf(input.usualSize) : null

  const basis: FitRecommendation['basis'] = body !== null && usual !== null ? 'both' : body !== null ? 'body' : 'usual'
  const base = body !== null && usual !== null ? (body + usual) / 2 : (body ?? usual ?? 2)
  const score = base + SHIFT[input.productCut ?? 'regular'][input.preference]

  const rounded = Math.round(score)
  const index = Math.max(0, Math.min(LETTER_SIZES.length - 1, rounded))

  // Confidence is distance from the nearest whole size: right on a size is
  // "high", halfway between two is "low".
  const offGrid = Math.abs(score - rounded)
  let confidence: Confidence = offGrid < 0.2 ? 'high' : offGrid < 0.35 ? 'medium' : 'low'

  if (basis === 'usual') {
    // A usual size is the shopper's own word, but sizes differ between
    // brands: never more than medium on that alone.
    confidence = confidence === 'low' ? 'low' : 'medium'
  }
  if (basis === 'both' && body !== null && usual !== null) {
    const gap = Math.abs(body - usual)
    // Two sources that disagree by more than a size: say so.
    if (gap > 1.2) confidence = 'low'
    else if (gap <= 0.5 && confidence === 'medium') confidence = 'high'
  }

  // Beyond the ends of the table the answer is a clamp, not a fit — never
  // present a clamped result as confident.
  if ((body !== null && (bmi < 16 || bmi > 35)) || score < -0.5 || score > LETTER_SIZES.length - 0.5) {
    confidence = 'low'
  }

  return { size: LETTER_SIZES[index], score, confidence, basis }
}

export type ProductFit =
  | { kind: 'exact'; size: string; ideal: LetterSize }
  /** The ideal size is not made in this product; `size` is the nearest one that is. */
  | { kind: 'not_carried'; size: string; ideal: LetterSize }
  /** The ideal size is made but sold out in this colour; `size` is the nearest in stock. */
  | { kind: 'sold_out'; size: string; ideal: LetterSize }
  /** Nothing in this product's run can be bought right now. */
  | { kind: 'none'; ideal: LetterSize }

/**
 * Fits the recommendation onto what THIS product actually offers.
 *
 * Never recommends a size the product does not make or cannot sell — that
 * would send the customer to a button that does nothing. When the ideal size
 * is unavailable it offers the nearest one that is, and says why. Ties go to
 * the LARGER size: slightly roomy is wearable, slightly tight is a return.
 */
export function fitToProduct(
  rec: FitRecommendation,
  productSizes: string[],
  isAvailable: (size: string) => boolean,
): ProductFit {
  const ideal = rec.size
  const target = indexOf(ideal)
  const carried = productSizes.filter((s) => indexOf(s) !== -1)

  const exact = carried.find((s) => indexOf(s) === target)
  if (exact && isAvailable(exact)) return { kind: 'exact', size: exact, ideal }

  const buyable = carried
    .filter(isAvailable)
    .sort((a, b) => {
      const da = Math.abs(indexOf(a) - target)
      const db = Math.abs(indexOf(b) - target)
      return da - db || indexOf(b) - indexOf(a)
    })

  if (!buyable.length) return { kind: 'none', ideal }
  return { kind: exact ? 'sold_out' : 'not_carried', size: buyable[0], ideal }
}

// ------------------------------------------- measurements vs. the garment --

/**
 * Wearing ease: how much room a piece needs BEYOND the body to hang the way
 * the shopper wants it to. A slim tee sits close; an oversized hoodie carries
 * a hand's width of air. Centimetres of chest circumference.
 */
const EASE_CM: Record<FitPreference, number> = { slim: 5, regular: 10, oversized: 18 }

/**
 * The size whose chest measurement best matches a measured chest.
 *
 * This is the one signal that beats height and weight, because it compares
 * like with like: the garment's own number against the body's. Returns null
 * when the product publishes no chart, which is most of them.
 */
export function sizeFromChest(
  chestCm: number,
  chart: { size: string; chest: number }[],
  preference: FitPreference,
): { size: string; ease: number } | null {
  const usable = chart.filter((row) => row.chest > 0)
  if (!usable.length) return null
  const target = chestCm + EASE_CM[preference]
  // The smallest size that still clears the target, else the largest made.
  const sorted = [...usable].sort((a, b) => a.chest - b.chest)
  const found = sorted.find((row) => row.chest >= target) ?? sorted[sorted.length - 1]
  return { size: found.size, ease: found.chest - chestCm }
}

/** How one area of the garment sits on this body. */
export type AreaVerdict = {
  /** 'chest' | 'waist' | 'hips' | 'length' | 'inseam' | 'foot' */
  area: string
  /** -2 tight … 0 perfect … +2 loose. */
  level: -2 | -1 | 0 | 1 | 2
  /** Centimetres of room (negative: short of the body). */
  slackCm?: number
}

function levelFromEase(slack: number, wanted: number): AreaVerdict['level'] {
  const delta = slack - wanted
  if (delta < -4) return -2
  if (delta < -1.5) return -1
  if (delta > 8) return 2
  if (delta > 3) return 1
  return 0
}

/**
 * The detailed reading behind the recommended size: one verdict per area the
 * shopper actually measured, compared against that size's own numbers.
 *
 * Areas nobody measured produce nothing. A fit finder that announces
 * "perfect in the shoulders" without having been told a shoulder measurement
 * is inventing the part the shopper is most likely to check.
 */
export function fitBreakdown(
  input: FitInput,
  row: { size: string; chest?: number; length?: number } | null,
  preference: FitPreference,
): AreaVerdict[] {
  const out: AreaVerdict[] = []
  if (!row) return out

  if (given(input.chestCm) && (row.chest ?? 0) > 0) {
    const slack = (row.chest as number) - input.chestCm
    out.push({ area: 'chest', level: levelFromEase(slack, EASE_CM[preference]), slackCm: Math.round(slack) })
  }
  // NO LENGTH VERDICT. Garment length was briefly derived from height (~39%
  // of it), which reads plausibly and is wrong: a cropped jacket and a long
  // coat on one body are both correct, and the proxy called a normal 65 cm
  // puffer on a 182 cm frame "noticeably tight". An area is only judged from
  // a measurement the shopper actually gave.
  return out
}

// ----------------------------------------------------------------- shoes --

/**
 * EU shoe size from a measured foot length.
 *
 * The Paris point: one size is ⅔ cm of LAST length, and a last runs about
 * 1.5 cm longer than the foot it is built for. So EU ≈ (foot + 1.5) × 1.5.
 * Brands vary by up to a full size, which is why the result carries the same
 * "estimate" framing as everything else here.
 */
export function euSizeFromFootLength(footLengthCm: number): number {
  return (footLengthCm + 1.5) * 1.5
}

export type ShoeFit = {
  /** The size from the product's own run, as the catalogue writes it. */
  size: string
  /** What the foot asked for, before rounding onto the run. */
  euExact: number
  /** Whether a wide or narrow foot should size differently. */
  widthNote: 'none' | 'wide' | 'narrow'
}

/** Picks the nearest size the product actually sells, rounding UP on a tie —
 *  a shoe half a size large is wearable, half a size small is a return. */
export function fitShoeToProduct(
  footLengthCm: number,
  sizes: string[],
  isAvailable: (size: string) => boolean,
  width: FootWidth = 'regular',
): ShoeFit | null {
  const euExact = euSizeFromFootLength(footLengthCm)
  // A wide foot takes the volume out of the length: half a size up.
  const target = euExact + (width === 'wide' ? 0.5 : width === 'narrow' ? -0.25 : 0)

  const numeric = sizes
    .map((s) => ({ size: s, value: Number.parseFloat(s.replace(',', '.')) }))
    .filter((s) => Number.isFinite(s.value))
  if (!numeric.length) return null

  const buyable = numeric.filter((s) => isAvailable(s.size))
  const pool = buyable.length ? buyable : numeric
  const best = pool.sort((a, b) => {
    const da = Math.abs(a.value - target)
    const db = Math.abs(b.value - target)
    return da - db || b.value - a.value
  })[0]

  return {
    size: best.size,
    euExact,
    widthNote: width === 'regular' ? 'none' : width,
  }
}

/** True when the run looks like shoe sizes (39, 40, 41…). */
export function isNumericSizeRun(sizes: string[]): boolean {
  if (!sizes.length) return false
  return sizes.every((s) => {
    const n = Number.parseFloat(s.replace(',', '.'))
    return Number.isFinite(n) && n >= 15 && n <= 60
  })
}

// ------------------------------------------------- the step-by-step finder --
//
// "Trova la tua misura" (components/products/size-finder) asks for height and
// weight, then a few things height and weight cannot see — age, hips,
// abdomen — and how the shopper wants THIS piece to sit, on a slider rather
// than three buttons. Same tables as recommendSize above; the extra answers
// move the size by fractions, never by whole sizes on their own.

/** -1 narrower / flatter than average, 0 average, +1 wider / rounder. */
export type ShapeLevel = -1 | 0 | 1

export type FinderInput = {
  heightCm: number
  weightKg: number
  /** Optional: the shopper may skip it. */
  age?: number
  hips?: ShapeLevel
  abdomen?: ShapeLevel
  /** The slider: -1 more fitted … 0 as designed … +1 looser. Continuous. */
  fit: number
  /** How the piece itself is cut (admin tag or read from its name). */
  productCut?: FitPreference
  /** Tops are led by chest and abdomen, bottoms by hips. */
  kind: 'tops' | 'bottoms'
}

export const AGE_RANGE = { min: 16, max: 100 } as const

/** Height and weight → a continuous index on the letter run (0 = XS). */
function bodyIndex(heightCm: number, weightKg: number): { index: number; bmi: number } {
  const meters = heightCm / 100
  const bmi = weightKg / (meters * meters)
  let index = bmiToIndex(bmi)
  if (heightCm >= 180) index += Math.min(1, (heightCm - 180) / 16)
  else if (heightCm <= 166) index -= Math.min(1, (166 - heightCm) / 16)
  return { index, bmi }
}

/**
 * How much each answer moves the size, per kind of garment.
 *
 * Hips decide trousers and skirts — a third of a size either way — and barely
 * touch a jacket. The abdomen is the reverse. Both are self-descriptions, so
 * neither can move the answer a whole size; together at most about two thirds.
 */
const SHAPE_WEIGHT = {
  tops: { hips: 0.12, abdomen: 0.32 },
  bottoms: { hips: 0.32, abdomen: 0.2 },
} as const

/**
 * Age: at one height and weight, more of the weight sits at the waist with
 * the years. A small nudge up from 40 and again from 55 — it can tip someone
 * who is between two sizes, never on its own move a whole size.
 */
function ageShift(age: number | undefined): number {
  if (age === undefined || !Number.isFinite(age)) return 0
  if (age >= 55) return 0.18
  if (age >= 40) return 0.1
  return 0
}

/** The fit slider onto the cut-aware shift table, interpolated between stops. */
function fitShift(fit: number, cut: FitPreference): number {
  const t = Math.max(-1, Math.min(1, fit))
  const row = SHIFT[cut]
  return t < 0 ? row.regular + (row.slim - row.regular) * -t : row.regular + (row.oversized - row.regular) * t
}

/** The continuous size index the finder's answers point to. */
export function finderScore(input: FinderInput): { score: number; bmi: number } {
  const { index, bmi } = bodyIndex(input.heightCm, input.weightKg)
  const w = SHAPE_WEIGHT[input.kind]
  const score =
    index +
    (input.hips ?? 0) * w.hips +
    (input.abdomen ?? 0) * w.abdomen +
    ageShift(input.age) +
    fitShift(input.fit, input.productCut ?? 'regular')
  return { score, bmi }
}

export type SizeShare = {
  size: string
  /** The chance, in percent, that this is the shopper's size. */
  percent: number
  /** Buyable now, in the colour chosen. */
  available: boolean
}

/** Below this chance of being the shopper's size, a size is never offered. */
export const MIN_MATCH = 30

/**
 * The finder's answer fitted onto this product. Unlike fitToProduct it never
 * offers "the nearest" for its own sake: a stand-in size is offered only when
 * it is itself a likely match, or the answer is "none" and says why.
 *
 * `ideal` is a size as the scale writes it: a letter for adults ("M"), a
 * height for children ("116").
 */
export type FinderFit =
  /** The size the answers point to — made, and in stock in this colour. */
  | { kind: 'exact'; size: string; ideal: string }
  /** The ideal size is sold out in this colour, or not made in this piece;
   *  `size` is another that is still a likely match. */
  | { kind: 'sold_out'; size: string; ideal: string }
  | { kind: 'not_carried'; size: string; ideal: string }
  /**
   * Nothing this product sells right now is a likely match. `range`: beyond
   * what the table can answer; `sold_out`: the ideal size is made but sold
   * out in this colour; `not_carried`: the ideal size is not made at all.
   */
  | { kind: 'none'; ideal: string; reason: 'range' | 'sold_out' | 'not_carried' }

/** Where the answers point, before looking at this product. */
export type FinderRec = {
  size: string
  /** The continuous position on the scale (0 = its first size). */
  score: number
  confidence: Confidence
}

export type FinderResult = {
  /** The size their answers point to, before looking at this product. */
  rec: FinderRec
  /** That answer fitted onto what this product makes and has in stock. */
  fit: FinderFit
  /**
   * For each size this product makes, the chance that it is the shopper's
   * size, highest first. A spread rather than a verdict, because between two
   * sizes is a real answer: "M 62 %, L 31 %" says more than "M". They add up
   * to 100 only when the product's run covers the shopper; when it does not,
   * the sizes it lacks keep their share and the bars stay short — "M 23 %,
   * L 10 %" is what "no size found" looks like.
   */
  shares: SizeShare[]
  /** Outside what the table can answer (very low or high BMI, or past the
   *  ends of the run): shown as "no size found", never as a confident size. */
  outOfRange: boolean
}

/**
 * How far the estimate looks past both ends of a scale. A frame beyond XXXL
 * keeps its chance out there instead of piling it onto XXXL. Three is past
 * the furthest any answer can reach (about -2.9 and 9.2 on the letters).
 */
const RUN_PAD = 3

/**
 * The shared half of the finder: a score on a size scale, fitted onto one
 * product. Adults and children differ only in the scale (letters, heights)
 * and in how the score is reached.
 *
 * The chances are a normal curve over the scale centred on the score, as
 * wide as the uncertainty: tight when the answers land squarely on one size,
 * broad when they sit between two or the frame is at the ends of the table.
 */
function fitOnScale(opts: {
  score: number
  outOfRange: boolean
  /** The scale's sizes, as they are written, in order. */
  scale: readonly string[]
  /** A product size's position on the scale (fractions allowed), or null
   *  when it is not on this scale at all. */
  position: (size: string) => number | null
  productSizes: string[]
  isAvailable: (size: string) => boolean
}): Omit<FinderResult, 'outOfRange'> {
  const { score, outOfRange, scale, position } = opts
  const rounded = Math.round(score)
  const index = Math.max(0, Math.min(scale.length - 1, rounded))
  const offGrid = Math.abs(score - rounded)
  const confidence: Confidence = outOfRange ? 'low' : offGrid < 0.2 ? 'high' : offGrid < 0.35 ? 'medium' : 'low'
  const ideal = scale[index]

  const sigma = outOfRange ? 1 : 0.42
  const weight = (i: number) => Math.exp(-((i - score) ** 2) / (2 * sigma * sigma))
  let total = 0
  for (let i = -RUN_PAD; i < scale.length + RUN_PAD; i++) total += weight(i)
  const chanceAt = (i: number) => (weight(i) / total) * 100

  // Ranked on the exact chance, ties to the LARGER size (slightly roomy is
  // wearable, slightly tight is a return); rounded only for display.
  const ranked = opts.productSizes
    .map((size) => ({ size, at: position(size) }))
    .filter((s): s is { size: string; at: number } => s.at !== null)
    .map(({ size, at }) => ({ size, at, exact: chanceAt(at), available: opts.isAvailable(size) }))
    .sort((a, b) => b.exact - a.exact || b.at - a.at)
  const shares = ranked.map(({ size, exact, available }) => ({ size, percent: Math.round(exact), available }))

  const isIdeal = (at: number) => Math.round(at) === index
  const idealMade = ranked.some((s) => isIdeal(s.at))
  const best = ranked.find((s) => s.available)
  let fit: FinderFit
  if (!outOfRange && best && best.exact >= MIN_MATCH) {
    fit = isIdeal(best.at)
      ? { kind: 'exact', size: best.size, ideal }
      : { kind: idealMade ? 'sold_out' : 'not_carried', size: best.size, ideal }
  } else {
    // Past the end of the scale, even the ideal size is not a likely match.
    const reason = outOfRange || chanceAt(index) < MIN_MATCH ? 'range' : idealMade ? 'sold_out' : 'not_carried'
    fit = { kind: 'none', ideal, reason }
  }

  return { rec: { size: ideal, score, confidence }, fit, shares }
}

/** The finder's whole answer for one adult product, on the letter run. */
export function finderRecommendation(
  input: FinderInput,
  productSizes: string[],
  isAvailable: (size: string) => boolean,
): FinderResult {
  const { score, bmi } = finderScore(input)
  const outOfRange = bmi < 16 || bmi > 35 || score < -0.75 || score > LETTER_SIZES.length - 0.25
  const position = (size: string) => {
    const i = indexOfSize(size)
    return i === -1 ? null : i
  }
  return { ...fitOnScale({ score, outOfRange, scale: LETTER_SIZES, position, productSizes, isAvailable }), outOfRange }
}

// ------------------------------------------------ children, sized by height --
//
// Children's clothes are sold by the height of the child they fit — 104, 110,
// 116, in steps of 6 cm (the European run). So the finder asks a child's
// height rather than height and weight, and the hips and abdomen answers and
// the fit slider move it along the same run, by fractions of a size, as for
// adults. Age is not asked: at one height, a child's age says little about
// the cut of a garment.

/** The European children's run, by height in cm. */
export const KIDS_RUN = [50, 56, 62, 68, 74, 80, 86, 92, 98, 104, 110, 116, 122, 128, 134, 140, 146, 152, 158, 164, 170, 176] as const
const KIDS_STEP = 6

/** Heights the children's table is meant for. Outside them we do not guess. */
export const KIDS_HEIGHT_RANGE = { min: 50, max: 185 } as const

/**
 * The height a children's size is for: "116" → 116, "110/116" or "110-116"
 * (a size that covers both) → 113. Null for anything else.
 */
export function kidsHeightOf(size: string): number | null {
  const m = size.trim().match(/^(\d{2,3})(?:\s*[/-]\s*(\d{2,3}))?\s*(?:cm)?$/i)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] ? Number(m[2]) : a
  const h = (a + b) / 2
  return h >= 44 && h <= 194 && b >= a ? h : null
}

/** True when every size is a child's height ("104", "110/116"). */
export function isKidsHeightRun(sizes: string[]): boolean {
  return sizes.length > 0 && sizes.every((s) => kidsHeightOf(s) !== null)
}

export type KidsFinderInput = {
  heightCm: number
  hips?: ShapeLevel
  abdomen?: ShapeLevel
  /** The slider: -1 more fitted … 0 as designed … +1 looser. Continuous. */
  fit: number
  productCut?: FitPreference
  kind: 'tops' | 'bottoms'
}

/** A child's answers as a position on KIDS_RUN (0 = 50 cm). */
export function kidsFinderScore(input: KidsFinderInput): number {
  const w = SHAPE_WEIGHT[input.kind]
  return (
    (input.heightCm - KIDS_RUN[0]) / KIDS_STEP +
    // A size is the height it fits UP TO: a child of 112 cm wears 116, not
    // 110. A third of a size up puts "just over" on the larger side, and a
    // child exactly on a size still on it.
    0.3 +
    (input.hips ?? 0) * w.hips +
    (input.abdomen ?? 0) * w.abdomen +
    fitShift(input.fit, input.productCut ?? 'regular')
  )
}

/** The finder's whole answer for one children's product, on the height run. */
export function kidsFinderRecommendation(
  input: KidsFinderInput,
  productSizes: string[],
  isAvailable: (size: string) => boolean,
): FinderResult {
  const score = kidsFinderScore(input)
  const outOfRange = input.heightCm < KIDS_HEIGHT_RANGE.min || input.heightCm > KIDS_HEIGHT_RANGE.max
  const position = (size: string) => {
    const h = kidsHeightOf(size)
    return h === null ? null : (h - KIDS_RUN[0]) / KIDS_STEP
  }
  const scale = KIDS_RUN.map(String)
  return { ...fitOnScale({ score, outOfRange, scale, position, productSizes, isAvailable }), outOfRange }
}

/**
 * Which finder a product gets: the letter run for adults, the height run for
 * children, or none (shoes, one-size pieces, children's pieces in letters —
 * the adult table says nothing about a child).
 */
export function finderRunFor(sizes: string[], group: string | undefined): 'adult' | 'kids' | null {
  if (group === 'kids') return isKidsHeightRun(sizes) ? 'kids' : null
  return isLetterSizeRun(sizes) ? 'adult' : null
}
