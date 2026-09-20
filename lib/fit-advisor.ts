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

export type UnitSystem = 'metric' | 'imperial'

/** Foot width, for the shoe run. */
export type FootWidth = 'narrow' | 'regular' | 'wide'

export type FitInput = {
  heightCm?: number
  weightKg?: number
  /** The size they usually wear in an ordinary cut. Enough on its own. */
  usualSize?: LetterSize
  preference: FitPreference
  /** How THIS product is cut — the admin's fit tag, or read from its name
   *  (lib/stylist/tagging.ts). Regular when unknown. */
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

export const toCm = (inches: number): number => inches * CM_PER_INCH
export const toInches = (cm: number): number => cm / CM_PER_INCH
export const toKg = (lb: number): number => lb * KG_PER_LB
export const toLb = (kg: number): number => kg / KG_PER_LB

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
