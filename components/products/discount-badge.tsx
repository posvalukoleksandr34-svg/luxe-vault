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
 * `−40%` — gold on the near-black ground, a hairline gold border, tabular
 * figures. Never red: in this palette red means an error, and a discount is
 * not one. Renders nothing (not an empty box) when there is no discount.
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
        'inline-flex shrink-0 items-center border border-gold/45 bg-background/85 px-1.5 py-0.5 text-[10px] font-medium leading-none tracking-[0.06em] text-gold tabular-nums',
        className,
      )}
    >
      {/* U+2212, a true minus — a hyphen sits too high and reads as a dash. */}
      −{pct}%
    </span>
  )
}
