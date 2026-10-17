import { cn } from '@/lib/utils'

/**
 * The discount, as a whole percentage — or 0 when there is none to show.
 *
 * Only a compare-at price genuinely ABOVE the price is a discount. An old price
 * equal to or below the current one (a data-entry slip, or a price that went
 * up) used to still strike through a number and could even compute a negative
 * "discount"; it now shows nothing at all.
 */
export function discountPercent(price: number, oldPrice: number | undefined | null): number {
  if (!oldPrice || oldPrice <= 0 || oldPrice <= price) return 0
  return Math.round(((oldPrice - price) / oldPrice) * 100)
}

/**
 * `−40%` — white figures on a solid black chip, tabular. Never red: a
 * discount is not an error, and the palette is black and white; black is
 * kept for exactly this kind of emphasis. Renders nothing (not an empty box)
 * when there is no discount.
 */
export function DiscountBadge({
  price,
  oldPrice,
  className,
}: {
  price: number
  oldPrice: number | undefined | null
  className?: string
}) {
  const pct = discountPercent(price, oldPrice)
  if (pct <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded bg-foreground px-1.5 py-1 text-[10px] font-medium leading-none tracking-[0.06em] text-background tabular-nums',
        className,
      )}
    >
      {/* U+2212, a true minus — a hyphen sits too high and reads as a dash. */}
      −{pct}%
    </span>
  )
}
