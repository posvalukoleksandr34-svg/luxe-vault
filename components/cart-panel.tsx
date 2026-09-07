'use client'

import { useRouter } from 'next/navigation'

import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import { TrustBadges } from '@/components/trust-badges'
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

  if (panel !== 'cart') return null

  return (
    <>
      <div
        className="animate-fade-in fixed inset-0 z-[60] bg-background/70 backdrop-blur-sm"
        onClick={() => setPanel(null)}
        aria-hidden
      />
      <div className="animate-slide-in-right fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col border-l border-border bg-popover">
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.image}
                      alt={item.name}
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
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground">
                  {t('cart.subtotal')}
                </span>
                <span className="font-serif text-xl font-light text-foreground">
                  {formatPrice(cartSubtotal)}
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
