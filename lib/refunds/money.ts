/**
 * Money for the refund system: integer MINOR units (rappen, cents), never
 * floating point.
 *
 * The orders table keeps francs as numeric(12,2). Supabase hands those to us
 * as JSON numbers (249.9), so the one place a float exists is the boundary:
 * toMinor() turns it into an integer once, via its decimal string, and every
 * sum, share and cap after that is integer arithmetic. Every currency the shop
 * charges in (CHF, EUR, USD) has two decimals.
 */

/** A major-unit amount (249.9, "249.90", 0.1) as an exact integer of minor
 *  units (24990). Refuses anything that is not a finite, non-negative amount
 *  with at most two decimals — a third decimal is a bug upstream, not a
 *  rounding opportunity. */
export function toMinor(value: number | string): number {
  const text = typeof value === 'number' ? numberToPlainString(value) : value.trim()
  const match = /^(\d{1,13})(?:\.(\d{1,2})0*)?$/.exec(text)
  if (!match) throw new RangeError(`Not a money amount: ${String(value)}`)
  const whole = Number(match[1])
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  return whole * 100 + fraction
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Not a money amount: ${value}`)
  // toFixed(2) of a two-decimal float is exact for every amount below 1e13;
  // a value with more decimals is caught by comparing back.
  const fixed = value.toFixed(2)
  if (Math.abs(Number(fixed) - value) > 1e-9) throw new RangeError(`More than two decimals: ${value}`)
  return fixed
}

/** Minor units back to a major-unit number, for display and for the
 *  numeric(12,2) columns that still speak francs. */
export function toMajor(minor: number): number {
  assertMinor(minor)
  return minor / 100
}

export function assertMinor(minor: number, allowNegative = false): void {
  if (!Number.isSafeInteger(minor) || (!allowNegative && minor < 0)) {
    throw new RangeError(`Not an integer amount of minor units: ${minor}`)
  }
}

/** "1'234.50 CHF"-style text for logs and admin messages (the UI formats with
 *  the store's formatPrice). */
export function formatMinor(minor: number, currency = 'CHF'): string {
  assertMinor(minor, true)
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')} ${currency}`
}

/**
 * Splits `total` minor units across `weights` in proportion, so the parts are
 * integers that add up to EXACTLY `total` (largest remainder; ties go to the
 * earlier entry, so the result is deterministic).
 *
 * Used to give each order line its share of an order-level discount or tax:
 * shares rounded independently can sum to a rappen more or less than the
 * discount, and that rappen is how a ledger stops reconciling.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  assertMinor(total)
  for (const w of weights) assertMinor(w)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (weights.length === 0) return []
  if (sum === 0) return weights.map(() => 0)

  const big = BigInt(total)
  const bigSum = BigInt(sum)
  const floors = weights.map((w) => (big * BigInt(w)) / bigSum)
  const remainders = weights.map((w, i) => big * BigInt(w) - floors[i] * bigSum)
  let left = Number(big - floors.reduce((a, b) => a + b, BigInt(0)))
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))
  const out = floors.map((f) => Number(f))
  for (const { i } of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}

/**
 * `amount` × numerator / denominator, rounded half up — in integers. Converts a
 * franc amount into the currency the card was charged in using the order's
 * OWN pair of figures (what it cost in francs, what was charged), not a
 * floating exchange rate.
 */
export function scale(amount: number, numerator: number, denominator: number): number {
  assertMinor(amount)
  assertMinor(numerator)
  assertMinor(denominator)
  if (denominator === 0) throw new RangeError('Cannot scale by a zero denominator')
  const n = BigInt(amount) * BigInt(numerator)
  const d = BigInt(denominator)
  return Number((n * BigInt(2) + d) / (d * BigInt(2)))
}

export function sumMinor(values: readonly number[]): number {
  let total = 0
  for (const v of values) {
    assertMinor(v)
    total += v
  }
  assertMinor(total)
  return total
}
