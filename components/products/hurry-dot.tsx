/** A small pulsing dot for the low-stock line ("Hurry! Only 2 left"). Holds
 *  still under reduced motion. */
export function HurryDot() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400/70 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-orange-500" />
    </span>
  )
}
