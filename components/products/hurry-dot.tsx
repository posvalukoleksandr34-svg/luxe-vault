/** A small, still dot beside the low-stock line ("2 left in stock"). It used
 *  to pulse in orange — urgency styling for a plain fact, which reads as a
 *  sales trick even when the number is real. */
export function HurryDot() {
  return <span className="inline-flex size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
}
