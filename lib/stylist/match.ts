import type { Look, StylistBrief } from '@/lib/stylist/types'

/**
 * How much of the brief a look actually delivered, 0-100.
 *
 * The number on a Curated Vault card. It is NOT the engine's internal score:
 * that is an unbounded ranking figure (40 for a style hit, 25 for a colour,
 * 3 for being on sale) whose maximum depends on how much the customer asked
 * for, so presenting it as a percentage would mean inventing a denominator.
 *
 * This is a different question, and one with an honest denominator: of the
 * things the customer ASKED for, how many did the look come back with? Every
 * term is read from what the engine itself recorded as the reason a piece was
 * chosen, so a card can never claim a match the engine did not make.
 *
 * Null when the brief is empty — six skipped questions is not a 0% match, it
 * is nothing to measure, and the card then shows no score at all.
 */
export function matchScore(look: Look, brief: StylistBrief): number | null {
  const items = look.items
  if (!items.length) return null

  /** Share of the look's pieces for which `test` holds. */
  const share = (test: (i: (typeof items)[number]) => boolean) =>
    items.filter(test).length / items.length

  const terms: number[] = []

  if (brief.occasion) {
    const wanted = brief.occasion
    terms.push(share((i) => i.reasons.some((r) => r.kind === 'occasion' && r.key === wanted)))
  }

  if (brief.style) {
    const wanted = brief.style
    terms.push(share((i) => i.reasons.some((r) => r.kind === 'style' && r.key === wanted)))
  }

  if (brief.colors && brief.colors.length) {
    const wanted = brief.colors
    terms.push(
      share((i) => i.reasons.some((r) => r.kind === 'color' && wanted.indexOf(r.key) !== -1)),
    )
  }

  if (brief.sizes && brief.sizes.length) {
    const wanted = brief.sizes
    // Only pieces that can be bought at all can honour a size preference; a
    // sold-out piece is already reported separately and should not be counted
    // as a size miss on top of that.
    const buyable = items.filter((i) => i.suggestedSize !== null)
    terms.push(
      buyable.length
        ? buyable.filter((i) => wanted.indexOf(i.suggestedSize!) !== -1).length / buyable.length
        : 0,
    )
  }

  if (typeof brief.budget === 'number' && brief.budget > 0) {
    // Under budget is a full match; over it decays with the size of the
    // overrun rather than dropping to zero, because a look 5% over is not the
    // same answer as one at double the price.
    const overrun = Math.max(0, look.total - brief.budget) / brief.budget
    terms.push(Math.max(0, 1 - overrun))
  }

  if (brief.notes && brief.notes.trim()) {
    // The engine turns words it recognised from the notes into `text` reasons.
    terms.push(share((i) => i.reasons.some((r) => r.kind === 'text')))
  }

  if (!terms.length) return null

  const average = terms.reduce((sum, t) => sum + t, 0) / terms.length
  return Math.max(0, Math.min(100, Math.round(average * 100)))
}
