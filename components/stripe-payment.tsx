'use client'

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import type { Appearance, StripeElementsOptions } from '@stripe/stripe-js'
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { isStripeClientConfigured, stripePromise } from '@/lib/stripe-client'
import { useStore } from '@/lib/store'
import type { Order } from '@/lib/types'

/**
 * Embedded card payment, rendered inside the checkout drawer.
 *
 * Replaces the redirect to checkout.stripe.com. The customer stays on the site
 * for the whole flow.
 *
 * This does NOT put card data on our page. PaymentElement is a cross-origin
 * iframe served by Stripe: the number, expiry and CVC are typed into Stripe's
 * document, not ours, and our JavaScript cannot read them. That is what keeps
 * the site out of the strictest PCI scope even though the form looks native.
 */

/**
 * Elements is themed through Stripe's Appearance API rather than CSS, because
 * the iframe cannot inherit our stylesheet. These values are the app's own
 * tokens, resolved to literals — the iframe has no access to CSS variables
 * either.
 */
const appearance: Appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#d4af37',
    colorBackground: '#16150f',
    colorText: '#f2ecdc',
    colorTextSecondary: '#a8a296',
    colorDanger: '#c4462f',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizeBase: '13px',
    spacingUnit: '4px',
    // Matches the app's hard-cornered, fashion-house geometry.
    borderRadius: '0px',
  },
  rules: {
    '.Input': {
      border: '1px solid rgba(148, 122, 56, 0.35)',
      boxShadow: 'none',
    },
    '.Input:focus': {
      border: '1px solid rgba(212, 175, 55, 0.55)',
      boxShadow: '0 0 0 1px rgba(212, 175, 55, 0.18)',
    },
    '.Label': {
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.15em',
      color: '#f2ecdc',
    },
  },
}

export function StripePayment({
  order,
  clientSecret,
  onPaid,
  onBack,
}: {
  order: Order
  clientSecret: string
  onPaid: () => void
  onBack: () => void
}) {
  // Memoised on clientSecret alone. A fresh options object each render would
  // remount the Element and clear a half-typed card number.
  const options: StripeElementsOptions = useMemo(
    () => ({ clientSecret, appearance }),
    [clientSecret],
  )

  if (!isStripeClientConfigured || !stripePromise) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-[12px] font-light text-destructive">
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set.
        </p>
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutForm order={order} onPaid={onPaid} onBack={onBack} />
    </Elements>
  )
}

/**
 * Must be a child of <Elements> — useStripe/useElements read from its context,
 * and both return null until Stripe.js has finished loading, which is why the
 * submit button stays disabled until they resolve.
 */
function CheckoutForm({
  order,
  onPaid,
  onBack,
}: {
  order: Order
  onPaid: () => void
  onBack: () => void
}) {
  const { t } = useStore()
  const stripe = useStripe()
  const elements = useElements()

  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Returning from a redirect-based method (3-D Secure, iDEAL, some wallets)
  // lands back here with the intent in the URL. Surface the outcome instead of
  // showing an empty form as though nothing had happened.
  useEffect(() => {
    if (!stripe) return
    const params = new URLSearchParams(window.location.search)
    const secret = params.get('payment_intent_client_secret')
    if (!secret) return

    void stripe.retrievePaymentIntent(secret).then(({ paymentIntent }) => {
      if (paymentIntent?.status === 'succeeded') onPaid()
      else if (paymentIntent?.status === 'requires_payment_method') {
        setError(t('checkout.paymentFailed'))
      }
    })
  }, [stripe, onPaid, t])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // Guard against a double submit creating two charge attempts.
    if (!stripe || !elements || submitting) return

    setSubmitting(true)
    setError(null)

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Only used for methods that must leave the page (3-D Secure step-up,
        // bank redirects). Card payments that need no challenge resolve right
        // here and never navigate — which is why the success path below is
        // handled in code as well as by this URL.
        return_url: `${window.location.origin}/success?order=${encodeURIComponent(order.id)}`,
      },
      // Keeps the customer on the page whenever Stripe does not strictly need
      // a redirect. Without this, every payment would bounce through a
      // full page load and lose the drawer.
      redirect: 'if_required',
    })

    if (confirmError) {
      // card_error / validation_error are safe to show verbatim — they are
      // written for customers ("Your card was declined"). Anything else is an
      // integration problem and gets a generic message.
      setError(
        confirmError.type === 'card_error' || confirmError.type === 'validation_error'
          ? (confirmError.message ?? t('checkout.paymentFailed'))
          : t('checkout.paymentFailed'),
      )
      setSubmitting(false)
      return
    }

    // No error and no redirect means the payment succeeded in place. The order
    // is still only marked paid by the signed webhook — this just advances the
    // UI.
    onPaid()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="card-gold p-4">
        <PaymentElement
          onReady={() => setReady(true)}
          options={{ layout: 'tabs' }}
        />
      </div>

      {error && (
        <p className="border-l-2 border-destructive bg-destructive/5 py-2 pl-3 text-[12px] font-light text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || !ready || submitting}
        className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-4 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
      >
        {submitting && <Loader2 className="size-3.5 animate-spin" />}
        {submitting ? t('checkout.paying') : t('checkout.payNow')}
      </button>

      <button
        type="button"
        onClick={onBack}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 disabled:opacity-40"
      >
        <ArrowLeft className="size-3" />
        {t('checkout.payLater')}
      </button>

      <p className="flex items-start gap-2 text-[11px] font-light leading-relaxed text-muted-foreground/60">
        <ShieldCheck className="mt-0.5 size-3 shrink-0 text-gold/50" strokeWidth={1.5} />
        {t('checkout.cardSecurity')}
      </p>
    </form>
  )
}
