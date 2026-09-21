'use client'

import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import type {
  Appearance,
  StripeElementsOptions,
  StripeError,
  StripeExpressCheckoutElementConfirmEvent,
  StripeExpressCheckoutElementOptions,
} from '@stripe/stripe-js'
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * Apple Pay and Google Pay as their own buttons, above the card form.
 *
 * Explicitly enabled rather than left to the Payment Element's defaults:
 * 'always' shows each button wherever the browser supports the wallet — Apple
 * Pay in Safari, Google Pay in Chrome — even before a card is saved in it.
 * The intent already allows them (automatic_payment_methods in
 * lib/server/stripe.ts); the domain must also be registered in the Stripe
 * Dashboard (Settings → Payment method domains) for them to appear on it.
 *
 * Styled to each brand's rules for a dark page: WHITE buttons — Apple and
 * Google both ask for the white style on dark backgrounds, where a black
 * button disappears — at 48px, the plain variant (the wallet mark alone), and
 * square corners from the Elements appearance above (borderRadius 0).
 * Link, PayPal and Amazon Pay stay off: the card form below covers them.
 */
const EXPRESS_OPTIONS: StripeExpressCheckoutElementOptions = {
  paymentMethods: {
    applePay: 'always',
    googlePay: 'always',
    link: 'never',
    paypal: 'never',
    amazonPay: 'never',
  },
  paymentMethodOrder: ['apple_pay', 'google_pay'],
  buttonType: { applePay: 'plain', googlePay: 'plain' },
  buttonTheme: { applePay: 'white', googlePay: 'white' },
  buttonHeight: 48,
  layout: { maxColumns: 2, maxRows: 1, overflow: 'never' },
}

/**
 * What went wrong, as the customer should hear it. Four kinds, each with its
 * own title: declined (the bank said no), incomplete (interrupted — 3-D
 * Secure abandoned or failed), network (we could not reach Stripe: try
 * again), and field (a card field is wrong — Stripe's own message, already in
 * the page's language, and the field is highlighted in the form).
 *
 * Never shows raw card data: Stripe's messages name the problem, not the card.
 */
type PaymentProblem = {
  kind: 'declined' | 'incomplete' | 'network' | 'field'
  message?: string
}

const PROBLEM_COPY = {
  declined: { title: 'pay.declinedTitle', body: 'pay.declinedBody' },
  incomplete: { title: 'pay.incompleteTitle', body: 'pay.incompleteBody' },
  network: { title: 'pay.networkTitle', body: 'pay.networkBody' },
} as const

function problemFrom(error: StripeError): PaymentProblem {
  if (error.type === 'validation_error') return { kind: 'field', message: error.message }
  // 3-D Secure failed or was closed: nothing charged, the payment just did
  // not finish.
  if (error.code === 'payment_intent_authentication_failure') return { kind: 'incomplete' }
  // Written for customers ("Your card has insufficient funds") and localised
  // by Stripe — worth showing as the explanation.
  if (error.type === 'card_error') return { kind: 'declined', message: error.message }
  if (error.type === 'api_connection_error' || error.type === 'rate_limit_error') {
    return { kind: 'network' }
  }
  return { kind: 'incomplete' }
}

export function StripePayment({
  order,
  clientSecret,
  chargeKey,
  disabled = false,
  onPaid,
  onBack,
}: {
  order: Order
  clientSecret: string
  /** Changes when the server re-prices the intent (another currency): the
   *  Element must then re-read it, or wallets would show the old amount. */
  chargeKey?: string
  /** True while the intent is being re-priced — nothing may be confirmed
   *  against an amount that is about to change. */
  disabled?: boolean
  onPaid: () => void
  onBack: () => void
}) {
  const { locale, t } = useStore()

  /**
   * `locale` is the SITE's language, passed explicitly.
   *
   * Left unset, Stripe uses 'auto' — the BROWSER's language, not the page's.
   * On an Italian page in a Russian-language browser that drew every Stripe
   * field (card number, expiry, CVC, country) and its billing labels and
   * error messages ("Your card was declined") in Russian. All five of the
   * site's locales are Stripe Elements locales, so the code passes straight
   * through.
   *
   * Memoised on the secret and the locale only. A fresh options object every
   * render would churn the Element; a locale change is applied in place by
   * elements.update(), so switching language mid-payment re-labels the form
   * without clearing a half-typed card number.
   */
  const options: StripeElementsOptions = useMemo(
    () => ({ clientSecret, appearance, locale }),
    [clientSecret, locale],
  )

  if (!isStripeClientConfigured || !stripePromise) {
    // A deployment without NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. The variable
    // name is for whoever reads the console, not for the customer.
    console.error('[stripe] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set.')
    return (
      <div className="border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-[12px] font-light text-destructive">{t('checkout.paymentUnavailable')}</p>
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutForm
        order={order}
        chargeKey={chargeKey}
        disabled={disabled}
        onPaid={onPaid}
        onBack={onBack}
      />
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
  chargeKey,
  disabled,
  onPaid,
  onBack,
}: {
  order: Order
  chargeKey?: string
  disabled: boolean
  onPaid: () => void
  onBack: () => void
}) {
  const { t } = useStore()
  const stripe = useStripe()
  const elements = useElements()

  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<PaymentProblem | null>(null)
  /** At least one wallet button is showing — decides whether the "or pay by
   *  card" divider has anything to divide. */
  const [expressShown, setExpressShown] = useState(false)

  /** Only used by methods that must leave the page (3-D Secure step-up, bank
   *  redirects); everything else resolves in place — see redirect below. */
  const returnUrl = () =>
    `${window.location.origin}/success?order=${encodeURIComponent(order.id)}`

  /**
   * A wallet sheet was approved. Confirmed exactly like the card form, against
   * the same intent — the webhook still decides that the order is paid. On a
   * failure the sheet is told so (it shows its own error), and the page shows
   * the same notice as a failed card.
   */
  async function handleExpressConfirm(event: StripeExpressCheckoutElementConfirmEvent) {
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl() },
      redirect: 'if_required',
    })
    if (confirmError) {
      event.paymentFailed({ reason: 'fail' })
      setError(problemFrom(confirmError))
      setSubmitting(false)
      return
    }
    onPaid()
  }

  // Re-read the intent after the server re-priced it in another currency.
  // Skipped on mount: the Element has only just fetched it.
  const lastChargeKey = useRef(chargeKey)
  useEffect(() => {
    if (!elements || chargeKey === lastChargeKey.current) return
    lastChargeKey.current = chargeKey
    void elements.fetchUpdates()
  }, [elements, chargeKey])

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
      // Klarna and Amazon Pay authorise on their own site and settle
      // afterwards, so a customer coming back mid-settlement finds the intent
      // `processing`, not `succeeded`. That is a completed checkout from their
      // side — the same path as a card, which lands on a page that reads the
      // order's real status and says "processing" until the webhook writes
      // `paid`. Left unhandled, this fell through and redrew the payment form
      // as though they had never paid.
      else if (paymentIntent?.status === 'processing') onPaid()
      else if (paymentIntent?.status === 'requires_payment_method') setError({ kind: 'declined' })
      else if (paymentIntent?.status === 'canceled') setError({ kind: 'incomplete' })
      // Came back without finishing the redirect (closed Klarna's tab, backed
      // out of Amazon's sign-in). Nothing was taken; the order is still payable.
      else if (paymentIntent?.status === 'requires_action') setError({ kind: 'incomplete' })
    })
  }, [stripe, onPaid, t])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // Guard against a double submit creating two charge attempts.
    if (!stripe || !elements || submitting || disabled) return

    setSubmitting(true)
    setError(null)

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Only used for methods that must leave the page (3-D Secure step-up,
        // bank redirects). Card payments that need no challenge resolve right
        // here and never navigate — which is why the success path below is
        // handled in code as well as by this URL.
        return_url: returnUrl(),
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
      setError(problemFrom(confirmError))
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
        {/* Renders nothing where no wallet is available, so it needs no
            wrapper of its own. A click while the intent is being re-priced
            is not resolved, so no sheet opens against a stale amount. */}
        <ExpressCheckoutElement
          options={EXPRESS_OPTIONS}
          onReady={({ availablePaymentMethods }) =>
            setExpressShown(Boolean(availablePaymentMethods && Object.values(availablePaymentMethods).some(Boolean)))
          }
          onClick={(event) => {
            if (disabled || submitting) return
            event.resolve()
          }}
          onConfirm={handleExpressConfirm}
        />
        {expressShown && (
          <div className="my-4 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {t('pay.orCard')}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
        <PaymentElement
          onReady={() => setReady(true)}
          // Wallets live in the Express Checkout buttons above; left on here
          // they would appear a second time as tabs.
          options={{ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never' } }}
        />
      </div>

      {/* In the shop's own tones — gold rule, quiet text — not a red alarm:
          a declined card is information, and the order is safe either way. */}
      {error && (
        <div role="alert" className="border-l-2 border-gold/50 bg-gold/[0.04] py-2.5 pl-3 pr-2">
          {error.kind !== 'field' && (
            <p className="text-[11px] uppercase tracking-[0.15em] text-foreground">
              {t(PROBLEM_COPY[error.kind].title)}
            </p>
          )}
          <p className="mt-1 text-[12px] font-light leading-relaxed text-muted-foreground">
            {error.message || (error.kind === 'field' ? t('checkout.paymentFailed') : t(PROBLEM_COPY[error.kind].body))}
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || !ready || submitting || disabled}
        className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-4 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
      >
        {submitting && <Loader2 className="size-3.5 animate-spin" />}
        {submitting
          ? t('checkout.paying')
          : error && error.kind !== 'field'
            ? t('pay.tryAgain')
            : t('checkout.payNow')}
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
