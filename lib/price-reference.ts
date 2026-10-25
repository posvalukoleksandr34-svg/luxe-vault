/**
 * The "was" price a reduction may be shown against — computed from the prices
 * the shop actually charged, never typed in.
 *
 * Swiss and EU price-indication rules (PBV art. 16; the EU Price Indication
 * Directive as amended by the Omnibus Directive, art. 6a) tie a strike-through
 * reference price to prices that really applied: the EU names the lowest price
 * of the 30 days before the reduction; Switzerland limits how long a self-
 * comparison may be advertised (half the time the higher price applied, at
 * most two months). This module applies the stricter reading of both:
 *
 *   - the reference is the LOWEST price in force during the 30 days before the
 *     current price took effect, and only counts if the shop's own history
 *     covers that whole window;
 *   - it is shown only while it is above the current price, and for at most
 *     half the time the earlier prices had applied, capped at 60 days.
 *
 * Anything short of that — no history, a history that does not reach back 30
 * days, a history out of step with the product's price — gives undefined, and
 * the storefront shows the price alone. Whether this is sufficient for every
 * market the shop sells to is for counsel to confirm; it never shows MORE
 * than it can prove.
 *
 * Pure: history in, number out.
 */

export type PricePoint = { price: number; validFrom: number }

const DAY = 24 * 60 * 60 * 1000
export const REFERENCE_WINDOW_MS = 30 * DAY
export const MAX_ADVERTISED_MS = 60 * DAY

const same = (a: number, b: number) => Math.abs(a - b) < 0.005

export function referencePrice(history: PricePoint[], currentPrice: number, now: number): number | undefined {
  const rows = history
    .filter((r) => Number.isFinite(r.price) && r.price >= 0 && Number.isFinite(r.validFrom) && r.validFrom <= now)
    .sort((a, b) => a.validFrom - b.validFrom)
  if (rows.length === 0 || !(currentPrice > 0)) return undefined

  // The record must describe the price on sale now.
  const last = rows[rows.length - 1]
  if (!same(last.price, currentPrice)) return undefined

  // When the current price started: back through consecutive rows at it.
  let i = rows.length - 1
  while (i > 0 && same(rows[i - 1].price, currentPrice)) i--
  const since = rows[i].validFrom
  const before = rows.slice(0, i)
  if (before.length === 0) return undefined

  // The price in force at the start of the window must be known: the last
  // row at or before it. Without one the 30 days are not covered.
  const windowStart = since - REFERENCE_WINDOW_MS
  let cover = -1
  for (let k = 0; k < before.length; k++) if (before[k].validFrom <= windowStart) cover = k
  if (cover === -1) return undefined

  const lowest = Math.min(...before.slice(cover).map((r) => r.price))
  if (!(lowest > currentPrice) || same(lowest, currentPrice)) return undefined

  // How long the reduction may be shown.
  const allowed = Math.min(MAX_ADVERTISED_MS, (since - before[cover].validFrom) / 2)
  if (now - since > allowed) return undefined

  return lowest
}
