'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import { TrustBadges } from '@/components/trust-badges'
import { trackBeginCheckout, trackViewCart } from '@/lib/analytics'
import { freeShippingGap, quoteShipping } from '@/lib/fulfilment'
import { formatPrice, useStore } from '@/lib/store'

export function CartPanel() {
  const router = useRouter()
  const {
    cart,
    panel,
    setPanel,
    updateCartQty,
    removeFromCart,
    clearCart,
    cartSubtotal,
    t,
  } = useStore()

  // An estimate against the undiscounted subtotal — the drawer has no promo
  // code. repriceItems() computes the figure that is actually charged.
  const estimatedShipping = quoteShipping(cartSubtotal)
  const shippingGap = freeShippingGap(cartSubtotal)

  // Fired when the drawer opens, before the early return below — a hook after
  // it would run conditionally and break the rules of hooks.
  const cartOpen = panel === 'cart'
  useEffect(() => {
    if (cartOpen && cart.length > 0) trackViewCart(cart, cartSubtotal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartOpen])

  // Escape closes the drawer. The backdrop already did, but a keyboard user
  // could not reach the backdrop — so without this the only way out was to
  // tab to the close button.
  useEffect(() => {
    if (panel !== 'cart') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, setPanel])

  if (panel !== 'cart') return null

  return (
    <>
      <div
        className="animate-fade-in fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm"
        onClick={() => setPanel(null)}
        aria-hidden
      />
      <div className="animate-slide-in-right fixed right-0 top-0 z-[100] flex h-full w-full max-w-md flex-col border-l border-border bg-popover"
        role="dialog"
        aria-modal="true"
        aria-label={t('cart.title')}>
        <div className="flex items-center justify-between border-b border-border/40 px-6 py-5">
          <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">
            {t('cart.title')}
          </h2>
          <button
            type="button"
            onClick={() => setPanel(null)}
            className="flex size-8 items-center justify-center text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-[18px]" />
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <ShoppingBag className="size-10 text-muted-foreground/20" strokeWidth={1} />
            <p className="text-sm font-light text-muted-foreground">{t('cart.empty')}</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-5">
                {cart.map((item) => (
                  <div key={item.key} className="flex gap-4">
                    <Image
                      src={item.image}
                      alt={item.name}
                      width={96}
                      height={96}
                      className="size-24 shrink-0 object-cover"
                    />
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[13px] font-light leading-snug text-foreground">
                          {item.name}
                        </h3>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.key)}
                          className="text-muted-foreground/50 transition hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/50">
                        {item.size} · {item.color}
                      </p>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <div className="flex items-center border border-border">
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.key, item.qty - 1)}
                            className="flex size-7 items-center justify-center text-muted-foreground transition hover:text-foreground"
                          >
                            <Minus className="size-3" />
                          </button>
                          <span className="w-7 text-center text-[12px] font-light tabular-nums text-foreground">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.key, item.qty + 1)}
                            className="flex size-7 items-center justify-center text-muted-foreground transition hover:text-foreground"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                        <span className="text-[13px] font-light text-foreground">
                          {formatPrice(item.price * item.qty)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border/40 px-6 py-5">
              {/* Free-shipping progress. Shown only while it is achievable and
                  not yet earned — a full bar that says "you did it" on every
                  subsequent render is noise, and a bar on an order that can
                  never qualify is a tease. */}
              {shippingGap ? (
                <div className="mb-4">
                  <p className="mb-2 text-[11px] font-light text-muted-foreground">
                    {t('cart.freeShippingGap')}{' '}
                    <span className="text-gold">{formatPrice(shippingGap.remaining)}</span>
                  </p>
                  <div
                    className="h-px w-full bg-border"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={shippingGap.threshold}
                    aria-valuenow={cartSubtotal}
                  >
                    <div
                      className="h-px bg-gold transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (cartSubtotal / shippingGap.threshold) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                cart.length > 0 && (
                  <p className="mb-4 text-[11px] font-light text-gold/80">
                    {t('cart.freeShippingEarned')}
                  </p>
                )
              )}

              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground">
                  {t('cart.subtotal')}
                </span>
                <span className="font-serif text-xl font-light text-foreground">
                  {formatPrice(cartSubtotal)}
                </span>
              </div>
              {/* Delivery is quoted, not charged, here: the authoritative
                  figure is computed server-side at checkout, and a promo code
                  entered later can still push the basket over the threshold. */}
              <div className="mb-4 flex items-center justify-between text-[12px] font-light">
                <span className="text-muted-foreground">{t('cart.shipping')}</span>
                <span className={estimatedShipping === 0 ? 'text-gold' : 'text-muted-foreground'}>
                  {estimatedShipping === 0 ? t('cart.free') : formatPrice(estimatedShipping)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={clearCart}
                  className="border border-border px-4 py-3.5 text-[12px] uppercase tracking-[0.1em] text-muted-foreground transition hover:text-foreground"
                >
                  {t('cart.clear')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Close the drawer and navigate in the same tick. The
                    // panel state is what renders the backdrop, so clearing it
                    // releases the overlay as the route changes rather than
                    // leaving a dimmed layer over the new page.
                    trackBeginCheckout(cart, cartSubtotal)
                    setPanel(null)
                    router.push('/checkout')
                  }}
                  className="flex-1 border border-gold/30 bg-gold/5 py-3.5 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
                >
                  {t('cart.checkout')}
                </button>
              </div>
              <TrustBadges />
            </div>
          </>
        )}
      </div>
    </>
  )
}
