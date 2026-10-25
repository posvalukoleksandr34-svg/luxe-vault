'use client'

import Image from 'next/image'
import { MAX_LINE_QTY } from '@/lib/cart-limits'
import { Link } from '@/components/locale-link'
import { useLocaleRouter } from '@/components/locale-link'
import { useEffect, useRef, useState } from 'react'

import { Check, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import { GuestCheckoutChoice } from '@/components/guest-checkout-choice'
import { EmptyState } from '@/components/state-view'
import { TrustBadges } from '@/components/trust-badges'
import { trackBeginCheckout, trackViewCart } from '@/lib/analytics'
import { freeShippingGap, quoteShipping } from '@/lib/fulfilment'
import { productImage } from '@/lib/product-image'
import { formatPrice, useProductsById, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { usePresence } from '@/lib/use-presence'
import { navigateWithTransition } from '@/lib/document-transition'

/**
 * The cart drawer: slides in from the right over a dimmed backdrop, from any
 * page (GlobalPanels mounts it once). Free-shipping progress on top, the lines
 * with quantity controls that stop at the stock of each size + colour, and a
 * footer with the subtotal and checkout that stays in place while the lines
 * scroll.
 */
export function CartPanel() {
  const router = useLocaleRouter()
  const {
    cart,
    cartCount,
    panel,
    setPanel,
    updateCartQty,
    removeFromCart,
    clearCart,
    cartSubtotal,
    shipping,
    currentUser,
    openAuth,
    currency,
    cartLineName,
    colorName,
    stockLimit,
    t,
    tf,
  } = useStore()

  /** The guest's "how would you like to check out?" step is showing. */
  const [choosing, setChoosing] = useState(false)
  /** They picked "Войти / Зарегистрироваться" and are in the account drawer. */
  const [pendingCheckout, setPendingCheckout] = useState(false)

  // An estimate against the undiscounted subtotal — the drawer has no promo
  // code. repriceItems() computes the figure that is actually charged.
  const estimatedShipping = quoteShipping(cartSubtotal, shipping)
  // Null once the admin's free-shipping threshold (store_settings) is met.
  const shippingGap = freeShippingGap(cartSubtotal, shipping)
  const threshold = shipping.freeShippingThreshold
  const shippingProgress = threshold > 0 ? Math.min(100, (cartSubtotal / threshold) * 100) : 100

  const cartOpen = panel === 'cart'

  // The lines' products, looked up when the drawer opens — for their names
  // in the visitor's language and their stock. The store realigns prices and
  // drops withdrawn lines as they arrive (reconcileCart).
  useProductsById(
    cart.map((line) => line.productId),
    { enabled: cartOpen },
  )

  /**
   * Enter AND exit transitions: mounted through the slide-out, `shown` is
   * what moves it (lib/use-presence.ts, the .motion-* classes).
   */
  const { mounted, state } = usePresence(cartOpen)
  const shown = state === 'open'
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus moves into the drawer, so a keyboard or screen-reader user lands in
  // the cart they just opened rather than on the page behind it.
  // Tab stays inside while it is open; closing hands focus back to the button
  // that opened it. Before the effect below: the trap records the opener, so
  // it must run while focus is still on it.
  useFocusTrap(dialogRef, shown)
  useEffect(() => {
    if (shown) dialogRef.current?.focus({ preventScroll: true })
  }, [shown])

  // The page behind must not scroll along with the lines.
  useEffect(() => {
    if (!cartOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [cartOpen])

  useEffect(() => {
    if (cartOpen && cart.length > 0) trackViewCart(cart, cartSubtotal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartOpen])

  // The choice is a step within one visit to the basket; reopening the cart
  // starts at the basket again, not at a question asked last time.
  useEffect(() => {
    if (!cartOpen) setChoosing(false)
  }, [cartOpen])

  /**
   * Finishes the checkout that was waiting for a sign-in.
   *
   * This component stays mounted while the account drawer is open (it only
   * renders nothing), so when the session arrives — sign-in, or registration
   * and its emailed code — the customer is taken straight on to checkout
   * rather than left in their account wondering where the basket went. If
   * they close the drawer without signing in, the intent lapses.
   */
  useEffect(() => {
    if (!pendingCheckout) return
    if (currentUser) {
      setPendingCheckout(false)
      trackBeginCheckout(cart, cartSubtotal)
      setPanel(null)
      // A full page load, not router.push: /checkout is served with its own
      // strict Content-Security-Policy (middleware.ts), and a policy belongs to
      // the DOCUMENT — a client-side navigation would keep this page's. It
      // still opens with the site's transition (lib/document-transition.ts).
      navigateWithTransition('/checkout')
      return
    }
    if (panel === null) setPendingCheckout(false)
  }, [pendingCheckout, currentUser, panel, cart, cartSubtotal, setPanel])

  // Escape closes the drawer. The backdrop already did, but a keyboard user
  // could not reach the backdrop — so without this the only way out was to
  // tab to the close button.
  useEffect(() => {
    if (!cartOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cartOpen, setPanel])

  if (!mounted) return null

  /**
   * Close the drawer and navigate in the same tick. The panel state is what
   * renders the backdrop, so clearing it releases the overlay as the route
   * changes rather than leaving a dimmed layer over the new page.
   *
   * `asGuest` tells /checkout the customer already chose — without it the
   * page would ask the same question a second time.
   */
  function goToCheckout(asGuest: boolean, from?: Element | null) {
    trackBeginCheckout(cart, cartSubtotal)
    // Where the checkout opens from, measured before the drawer starts to go.
    const origin = from?.isConnected ? from : null
    setPanel(null)
    // Full page load, for the same reason as above: the payment page's strict
    // CSP only applies to a document it was served with. The checkout grows
    // out of the button that was pressed (lib/document-transition.ts).
    navigateWithTransition(asGuest ? '/checkout?guest=1' : '/checkout', { from: origin })
  }

  // "Add CHF 120 more for Free Shipping", with the amount set in gold.
  const [addBefore, addAfter = ''] = t('cart.freeShippingAddMore').split('{amount}')

  return (
    <>
      <div
        data-state={state}
        className="motion-scrim fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm"
        onClick={() => setPanel(null)}
        aria-hidden
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-state={state}
        inert={!cartOpen || undefined}
        className="motion-drawer-right fixed right-0 top-0 z-[100] flex h-full w-full max-w-md flex-col border-l border-border bg-popover shadow-2xl outline-none"
        role="dialog"
        aria-modal="true"
        aria-label={t('cart.title')}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-6 py-5">
          <h2 className="flex items-baseline gap-2.5 font-serif text-xl font-bold tracking-tight text-foreground">
            {t('cart.title')}
            {cartCount > 0 && (
              <span className="font-sans text-[11px] font-normal tabular-nums tracking-[0.15em] text-muted-foreground">
                {cartCount}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => setPanel(null)}
            aria-label={t('cart.close')}
            className="flex size-8 items-center justify-center text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-[18px]" />
          </button>
        </div>

        {cart.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            className="flex-1 px-6"
            title={t('cart.empty')}
            hint={t('state.cartHint')}
            action={{
              label: t('state.goToCatalog'),
              onClick: () => {
                setPanel(null)
                router.push('/catalog')
              },
            }}
          />
        ) : choosing ? (
          // An intermediate step INSIDE the drawer rather than a dialog over
          // it: the drawer sits at z-[100], above the shared dialog layer, so a
          // dialog opened from here would render underneath the basket.
          <GuestCheckoutChoice
            onGuest={(e) => goToCheckout(true, e?.currentTarget)}
            onSignIn={() => {
              setChoosing(false)
              setPendingCheckout(true)
              openAuth('login')
            }}
            onBack={() => setChoosing(false)}
          />
        ) : (
          <>
            {/* Free-shipping progress, against the admin's threshold. Shown at
                the top, where it is read before the lines, and kept once it is
                earned — in green, with a tick — so the customer sees the
                reward rather than a bar that silently disappears. */}
            <div className="border-b border-border/40 px-6 py-4" aria-live="polite">
              <p
                className={cn(
                  'mb-2.5 flex items-center gap-2 text-[12px] font-light',
                  shippingGap ? 'text-muted-foreground' : 'text-emerald-700/90',
                )}
              >
                {shippingGap ? (
                  <span>
                    {addBefore}
                    <span className="font-normal text-gold">{formatPrice(shippingGap.remaining, true)}</span>
                    {addAfter}
                  </span>
                ) : (
                  <>
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                      <Check className="size-3 text-emerald-700" strokeWidth={2.5} />
                    </span>
                    {t('cart.freeShippingCongrats')}
                  </>
                )}
              </p>
              <div
                className="h-[3px] w-full overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-label={t('cart.shipping')}
                aria-valuemin={0}
                aria-valuemax={threshold}
                aria-valuenow={Math.min(cartSubtotal, threshold)}
              >
                <div
                  className={cn(
                    'h-full rounded-full transition-[width,background-color] duration-500 ease-out',
                    shippingGap ? 'bg-gold' : 'bg-emerald-500/80',
                  )}
                  style={{ width: `${shippingProgress}%` }}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
              <ul className="space-y-5">
                {cart.map((item) => {
                  // This exact size and colour: "+" stops at what exists.
                  const limit = stockLimit(item.productId, item.size, item.color)
                  const atMax = (limit !== null && item.qty >= limit) || item.qty >= MAX_LINE_QTY
                  // Which ceiling it is: the stock ("only 3 left") or the
                  // per-order cap on one item (MAX_LINE_QTY), said as such.
                  const atMaxNote = !atMax
                    ? undefined
                    : limit === 0
                      ? t('sold.out')
                      : limit !== null && limit <= MAX_LINE_QTY
                        ? tf('stock.onlyInSize', { n: limit, size: item.size })
                        : tf('cart.maxPerLine', { n: MAX_LINE_QTY })
                  const name = cartLineName(item)
                  return (
                    <li key={item.key} className="flex gap-4">
                      <Link
                        href={`/product/${encodeURIComponent(item.productId)}`}
                        onClick={() => setPanel(null)}
                        className="shrink-0"
                        tabIndex={-1}
                        aria-hidden
                      >
                        {/* The photo travels from here into the product page's gallery. */}
                        <Image
                          src={productImage(item.image)}
                          alt=""
                          width={96}
                          height={96}
                          data-vt-product={item.productId}
                          className="size-24 rounded-xl object-cover"
                        />
                      </Link>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={`/product/${encodeURIComponent(item.productId)}`}
                            onClick={() => setPanel(null)}
                            className="text-[13px] font-light leading-snug text-foreground transition hover:text-gold"
                          >
                            {name}
                          </Link>
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.key)}
                            aria-label={`${t('cart.remove')}: ${name}`}
                            className="-mr-1 flex size-7 shrink-0 items-center justify-center text-muted-foreground/85 transition hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/85">
                          {[item.size, colorName(item.color)].filter(Boolean).join(' · ')}
                        </p>
                        {atMaxNote && <p className="mt-1 text-[10px] font-light text-gold">{atMaxNote}</p>}
                        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
                          <div className="flex items-center rounded-xl border border-border">
                            <button
                              type="button"
                              onClick={() => updateCartQty(item.key, item.qty - 1)}
                              disabled={item.qty <= 1}
                              aria-label={t('product.decrease')}
                              className="flex size-7 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <Minus className="size-3" />
                            </button>
                            <span className="w-7 text-center text-[12px] font-light tabular-nums text-foreground" aria-live="polite">
                              {item.qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateCartQty(item.key, item.qty + 1)}
                              disabled={atMax}
                              aria-label={t('product.increase')}
                              title={atMaxNote}
                              className="flex size-7 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <Plus className="size-3" />
                            </button>
                          </div>
                          <div className="text-right">
                            <p className="text-[13px] font-light tabular-nums text-foreground">
                              {formatPrice(item.price * item.qty)}
                            </p>
                            {item.qty > 1 && (
                              <p className="text-[10px] font-light tabular-nums text-muted-foreground/85">
                                {formatPrice(item.price)} × {item.qty}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="border-t border-border/40 bg-popover px-6 pb-5 pt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground">
                  {t('cart.subtotal')}
                </span>
                <span className="font-serif text-xl font-light tabular-nums text-foreground">
                  {formatPrice(cartSubtotal)}
                </span>
              </div>
              {/* Delivery is quoted, not charged, here: the authoritative
                  figure is computed server-side at checkout, and a promo code
                  entered later can still push the basket over the threshold. */}
              <div className="mb-4 flex items-center justify-between text-[12px] font-light">
                <span className="text-muted-foreground">{t('cart.shipping')}</span>
                <span className={estimatedShipping === 0 ? 'text-emerald-700/90' : 'text-muted-foreground'}>
                  {estimatedShipping === 0 ? t('cart.free') : formatPrice(estimatedShipping, true)}
                </span>
              </div>
              {/* How converted prices are paid: by card in this currency, crypto in CHF. */}
              {currency !== 'CHF' && (
                <p className="-mt-2 mb-4 text-[10px] font-light leading-relaxed text-muted-foreground/85">
                  {tf('cart.indicativeCurrency', { currency })}
                </p>
              )}
              <button
                type="button"
                onClick={(e) => {
                  // Signed in: straight to checkout. Otherwise the choice —
                  // never a wall.
                  if (currentUser) goToCheckout(false, e.currentTarget)
                  else setChoosing(true)
                }}
                className="rounded-xl w-full bg-gold-gradient py-4 text-[13px] font-medium uppercase tracking-[0.18em] text-gold-foreground transition-all duration-300 hover:brightness-[1.05] shadow-gold"
              >
                {t('cart.checkout')} · {formatPrice(cartSubtotal)}
              </button>
              <button
                type="button"
                onClick={clearCart}
                className="mt-2 w-full py-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/85 transition hover:text-foreground"
              >
                {t('cart.clear')}
              </button>
              <TrustBadges />
            </div>
          </>
        )}
      </div>
    </>
  )
}
