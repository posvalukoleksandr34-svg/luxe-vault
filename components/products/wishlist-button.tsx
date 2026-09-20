'use client'

import { Heart } from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Save / unsave one product.
 *
 * A real <button> that sits OUTSIDE the card's link rather than inside it:
 * a control nested in an <a> is invalid markup, unreachable by keyboard in
 * the order people expect, and would follow the link on Enter.
 *
 * The state lives in the store (lib/wishlist.ts), so pressing this updates
 * the bottom bar's badge and every other copy of the same product on screen
 * at once. `aria-pressed` is what tells a screen reader whether the product is
 * currently saved; the label says which product, since a grid has many.
 */
export function WishlistButton({
  productId,
  productName,
  className,
  size = 'md',
}: {
  productId: string
  productName: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const { isWishlisted, toggleWishlist, tf } = useStore()
  const saved = isWishlisted(productId)

  return (
    <button
      type="button"
      onClick={() => toggleWishlist(productId)}
      aria-pressed={saved}
      aria-label={tf(saved ? 'wishlist.remove' : 'wishlist.add', { name: productName })}
      className={cn(
        'no-juice group/wish flex items-center justify-center border transition-colors duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        size === 'sm' ? 'size-9' : 'size-10',
        saved
          ? 'border-gold/60 bg-background/80 text-gold'
          : 'border-white/15 bg-background/60 text-neutral-300 backdrop-blur-sm hover:border-gold/50 hover:text-gold',
        className,
      )}
    >
      <Heart
        aria-hidden
        strokeWidth={1.5}
        className={cn('size-[18px] transition-transform duration-300 group-hover/wish:scale-110', saved && 'fill-gold')}
      />
    </button>
  )
}
