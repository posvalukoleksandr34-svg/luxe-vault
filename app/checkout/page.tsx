'use client'

import { ArrowLeft, ShoppingBag } from 'lucide-react'
import Image from 'next/image'
import { Link } from '@/components/locale-link'
import { useState } from 'react'
import { CheckoutFlow } from '@/components/checkout-flow'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Header } from '@/components/header'
import { EmptyState } from '@/components/state-view'
import { productImage } from '@/lib/product-image'
import { formatPrice, useProductsById, useStore } from '@/lib/store'

/**
 * Dedicated checkout screen.
 *
 * Checkout used to live in the same 448px right-hand drawer as the cart, which
 * had to hold an address form, an autocomplete dropdown, a payment-method
 * chooser, two save toggles and Stripe's PaymentElement. On a laptop that is a
 * column of inputs three screens tall; the Element alone is ~770px.
 *
 * A route also gives checkout what a drawer cannot: a URL to return to after a
 * 3-D Secure redirect, a back-button that means something, and room for the
 * order summary to sit beside the form instead of below it.
 *
 * Client component because the cart lives in React state, which is also why
 * the empty-cart guard below matters — see the note there.
 */
export default function CheckoutPage() {
  const { cart, cartReady, cartCount, cartSubtotal, cartLineName, colorName, t } = useStore()

  // The lines' products, looked up by id — see the cart drawer.
  useProductsById(cart.map((line) => line.productId))

  // Set once the order exists server-side. From that point the cart is
  // legitimately empty — the order holds the items — so the empty-cart screen
  // must not take over and unmount the payment step mid-flow.
  const [orderPlaced, setOrderPlaced] = useState(false)

  // The cart is in-memory, so a hard refresh or a pasted /checkout URL lands
  // here with nothing to buy. Showing the form against an empty cart would let
  // someone fill in an address and then fail at submit; saying so up front and
  // pointing back to the shop is the honest version.
  // The saved cart is read in the browser, after the server has rendered
  // this page with none. Until it is, say only where the customer is: the
  // page that is about to appear, not "your cart is empty" (which flashed on
  // every visit with a full basket, and was all a slow connection showed).
  if (!cartReady && !orderPlaced) {
    return (
      <>
        <Header />
        <main id="main" aria-busy="true" className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          {/* The same frame as the page below, so nothing jumps when it arrives. */}
          <div aria-hidden className="mb-4 h-4 w-40 animate-pulse rounded bg-muted/60" />
          <div aria-hidden className="mb-8 h-4 w-32 animate-pulse rounded bg-muted/60" />
          <h1 className="mb-8 font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t('checkout.title')}</h1>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14" aria-hidden>
            <div className="space-y-4">
              {[0, 1, 2, 3, 4].map((n) => (
                <div key={n} className="h-12 animate-pulse rounded-xl bg-muted/60" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-2xl bg-muted/60" />
          </div>
        </main>
      </>
    )
  }

  if (cart.length === 0 && !orderPlaced) {
    return (
      <>
        <Header />
        <main id="main" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
          <EmptyState
            asHeading={1}
            icon={ShoppingBag}
            title={t('cart.empty')}
            hint={t('state.cartHint')}
            action={{ label: t('state.goToCatalog'), href: '/catalog' }}
          />
        </main>
      </>
    )
  }

  return (
    <>
      <Header />

      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        {/* Breadcrumbs AND the back link, which do different jobs: the trail
            says where this page sits, the link is the explicit way out that a
            checkout should always offer. */}
        <Breadcrumbs
          className="mb-4"
          trail={[
            { name: t('common.home'), url: '/' },
            { name: t('checkout.title'), url: '/checkout' },
          ]}
        />

        <Link
          href="/catalog"
          className="mb-8 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-gold"
        >
          <ArrowLeft className="size-3" />
          {t('cart.continueShopping')}
        </Link>

        <h1 className="mb-8 font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t('checkout.title')}
        </h1>

        {/* Two columns from lg up: the form is long and the summary is short,
            so stacking them would push the total below the fold on every
            screen. The summary sticks so the amount stays visible while the
            customer works down the form. */}
        {/* grid-cols-1 on a phone is load-bearing: without an explicit
            column the grid's single implicit column is `auto`, which grows to
            the widest min-content inside it — and a cart line's name is
            `truncate` (nowrap), so one long product name widened the column,
            and the form with it, past the screen. minmax(0,1fr) keeps the
            column at the container's width; the name ellipsises instead. */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
          <div className="min-w-0">
            <CheckoutFlow onOrderCreated={() => setOrderPlaced(true)} />
          </div>

          {/* Hidden once the order exists: the cart is empty by then, and an
              empty summary beside a live payment form is just confusing. */}
          {!orderPlaced && (
          <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <div className="card-gold p-5">
              <h2 className="mb-4 border-b border-border/50 pb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t('cart.title')} · {cartCount}
              </h2>
              <ul className="divide-y divide-border/40">
                {cart.map((item) => (
                  <li key={item.key} className="flex items-center gap-3 py-3 first:pt-0">
                    <Image
                      src={productImage(item.image)}
                      alt={cartLineName(item)}
                      width={48}
                      height={48}
                      className="size-12 shrink-0 rounded-xl border border-border/60 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-light text-foreground">
                        {cartLineName(item)}
                      </p>
                      <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/85">
                        {[item.size, colorName(item.color), `×${item.qty}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12px] font-light tabular-nums text-foreground">
                      {formatPrice(item.price * item.qty)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-between border-t border-border/50 pt-3">
                <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                  {t('cart.subtotal')}
                </span>
                <span className="font-serif text-lg text-gold">{formatPrice(cartSubtotal)}</span>
              </div>
            </div>
          </aside>
          )}
        </div>
      </main>
    </>
  )
}
