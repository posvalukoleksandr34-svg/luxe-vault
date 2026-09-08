'use client'

import { AlertCircle, ArrowLeft, Check, LogIn, Trash2, Wand2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import type { CountryCode } from 'libphonenumber-js'
import { AddressAutocomplete } from '@/components/address-autocomplete'
import { CountrySelect } from '@/components/country-select'
import { CryptoPayment } from '@/components/crypto-payment'
import { StripePayment } from '@/components/stripe-payment'
import { DEFAULT_COUNTRY, PhoneInput } from '@/components/phone-input'
import { TrustBadges } from '@/components/trust-badges'
import { CARD_PAYMENT_METHOD, CRYPTO_PAYMENT_METHOD } from '@/lib/data'
import { trackAddPaymentInfo } from '@/lib/analytics'
import { quoteShipping } from '@/lib/fulfilment'
import { rememberOrder } from '@/lib/order-registry'
import { clearSavedProfile, readSavedProfile, writeSavedProfile } from '@/lib/saved-profile'
import { useStore, formatPrice } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  formatPhone,
  isValidEmail,
  isValidName,
  isValidPhone,
  validateAddress,
} from '@/lib/validation'
import type { Order } from '@/lib/types'

type FieldKey = 'name' | 'phone' | 'email' | 'street' | 'postalCode' | 'city'

export function CheckoutFlow({
  onOrderCreated,
}: {
  /**
   * Fired the moment the order exists server-side, before the cart is cleared.
   *
   * The page guards on an empty cart and shows "your cart is empty" — correct
   * for someone who lands on /checkout directly, but fatal mid-flow: clearing
   * the cart used to unmount this component before the payment step could
   * render, which read to the customer as "Confirm Order wiped my basket".
   * This lets the page know an order is in flight and keep the flow mounted.
   */
  onOrderCreated?: () => void
} = {}) {
  const {
    setPanel,
    cart,
    cartSubtotal,
    paymentMethods,
    applyPromo,
    clearCart,
    pushToast,
    currentUser,
    t,
  } = useStore()

  const router = useRouter()

  const [form, setForm] = useState({
    name: '',
    phone: '',
    phoneCountry: DEFAULT_COUNTRY as CountryCode,
    email: '',
    street: '',
    postalCode: '',
    city: '',
    country: DEFAULT_COUNTRY as CountryCode,
    payment: paymentMethods[0],
    promo: '',
  })
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; percent: number } | null>(null)
  const [promoError, setPromoError] = useState(false)
  const [showCrypto, setShowCrypto] = useState(false)
  const [cryptoOrder, setCryptoOrder] = useState<Order | null>(null)
  // Embedded card step: the order exists, and Stripe has minted a client
  // secret for it. Rendering these together keeps the customer in the drawer
  // instead of redirecting to checkout.stripe.com.
  const [cardOrder, setCardOrder] = useState<Order | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  /**
   * Submission failure, shown inline above the button.
   *
   * A toast was the only feedback before, which is wrong for this step: it
   * auto-dismisses, it can be missed while the customer is looking at the
   * form, and it discarded the server's actual message — so "please sign in"
   * (401), "invalid address" (400) and "could not verify session" (503) all
   * read as the same opaque failure.
   */
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Remembered checkout details. `hasSaved` is read once on open rather than
  // on every render: localStorage is synchronous and would otherwise be hit
  // on each keystroke.
  const [saveDetails, setSaveDetails] = useState(false)
  const [saveCard, setSaveCard] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)

  // Entering the checkout panel fresh (e.g. after a previous crypto flow
  // completed or was abandoned) should never resume mid-payment.
  // Runs once on mount. The drawer version keyed this off `panel` flipping to
  // 'checkout'; on a route, mounting IS the open event.
  useEffect(() => {
    const saved = readSavedProfile()
    setHasSaved(Boolean(saved))
    setSaveDetails(Boolean(saved))
  }, [])

  /**
   * The signed-in customer's default address, if they have one.
   *
   * Prefilling from the server rather than from localStorage is what makes the
   * address book worth having: it follows the customer to a second device.
   * Only the DEFAULT is applied, and only when the form is still untouched —
   * overwriting something already typed would be hostile, and someone sending
   * a gift elsewhere would have to clear it.
   */
  useEffect(() => {
    if (!currentUser) return
    let active = true

    fetch('/api/account/addresses')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data?.addresses?.length) return
        const preferred = data.addresses.find((a: { isDefault: boolean }) => a.isDefault)
        if (!preferred) return
        setForm((prev) =>
          prev.name || prev.street
            ? prev
            : {
                ...prev,
                name: preferred.name ?? '',
                phone: preferred.phone ?? '',
                street: preferred.street ?? '',
                postalCode: preferred.postalCode ?? '',
                city: preferred.city ?? '',
                country: (preferred.country ?? prev.country) as CountryCode,
                phoneCountry: (preferred.country ?? prev.phoneCountry) as CountryCode,
              },
        )
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [currentUser])


  const discount = appliedPromo
    ? Math.round((cartSubtotal * appliedPromo.percent) / 100)
    : 0
  // Mirrors repriceItems() so the customer sees the same figure the server
  // will charge. The server's version is authoritative; this one exists so the
  // summary is not a lie while they are deciding.
  const discountedSubtotal = cartSubtotal - discount
  const shippingCost = quoteShipping(discountedSubtotal)
  const total = discountedSubtotal + shippingCost

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key in errors) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[key as FieldKey]
        return next
      })
    }
  }

  async function handleApplyPromo() {
    const promo = await applyPromo(form.promo)
    if (promo) {
      setAppliedPromo({ code: promo.code, percent: promo.percent })
      setPromoError(false)
      pushToast({ title: t('toast.promoApplied'), variant: 'gold' })
    } else {
      setPromoError(true)
      pushToast({ title: t('toast.promoInvalid'), variant: 'default' })
    }
  }

  /** Runs every rule and returns the composed customer payload, or null when
   * something is invalid (with the offending fields marked). */
  function validate() {
    const next: Partial<Record<FieldKey, string>> = {}

    if (!form.name.trim()) next.name = t('checkout.fieldRequired')
    else if (!isValidName(form.name)) next.name = t('checkout.errName')

    if (!form.phone.trim()) next.phone = t('checkout.fieldRequired')
    else if (!isValidPhone(form.phone, form.phoneCountry)) next.phone = t('checkout.errPhone')

    if (!form.email.trim()) next.email = t('checkout.fieldRequired')
    else if (!isValidEmail(form.email)) next.email = t('checkout.errEmail')

    const addressErrors = validateAddress({
      street: form.street,
      postalCode: form.postalCode,
      city: form.city,
      country: form.country,
    })
    for (const field of addressErrors) {
      if (!form[field].trim()) next[field] = t('checkout.fieldRequired')
      else if (field === 'street') next.street = t('checkout.errStreet')
      else if (field === 'postalCode') next.postalCode = t('checkout.errPostalCode')
      else next.city = t('checkout.errCity')
    }

    setErrors(next)
    if (Object.keys(next).length > 0) return null

    return {
      name: form.name.trim(),
      phone: formatPhone(form.phone, form.phoneCountry) ?? form.phone.trim(),
      email: form.email.trim(),
      street: form.street.trim(),
      postalCode: form.postalCode.trim(),
      city: form.city.trim(),
      country: form.country,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return

    const customer = validate()
    if (!customer) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      // The order is always persisted first — the server mints the id, the
      // lookup token and the payment status. If the customer then walks away
      // from the payment screen, the order survives as `pending_payment`
      // and can be paid later from their account.
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          items: cart,
          subtotal: cartSubtotal,
          discount,
          total,
          promo: appliedPromo?.code,
          payment: form.payment,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.order) {
        // Sold out between adding to the cart and paying. Name the line so the
        // customer knows which one to change rather than hunting the basket.
        if (res.status === 409 && data.error === 'OUT_OF_STOCK') {
          setSubmitError(
            data.item ? `${t('checkout.outOfStock')} — ${data.item}` : t('checkout.outOfStock'),
          )
          return
        }
        // Otherwise surface the server's own wording — it is written for
        // customers and says what to actually do about it.
        setSubmitError(data.error || t('checkout.orderFailed'))
        return
      }

      trackAddPaymentInfo(data.order.total, form.payment)
      const order: Order = data.order
      if (order.lookupToken) rememberOrder({ id: order.id, token: order.lookupToken })

      // Written only once the order is actually accepted — saving a rejected
      // form would remember an address the server already refused.
      if (saveDetails) {
        writeSavedProfile({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          phoneCountry: form.phoneCountry,
          street: form.street.trim(),
          postalCode: form.postalCode.trim(),
          city: form.city.trim(),
          country: form.country,
        })
      } else {
        // Unticking is an instruction to forget, not merely to skip saving.
        clearSavedProfile()
      }

      // The customer stays on /checkout and pays here. The cart is cleared so
      // the page's empty-cart guard does not fight the payment step — see
      // onOrderCreated, which tells the page to hold the flow mounted.
      //
      // Nothing navigates until the payment actually succeeds.
      onOrderCreated?.()
      clearCart()

      if (form.payment === CRYPTO_PAYMENT_METHOD && order.lookupToken) {
        // Pay immediately, against the order we just created.
        setCryptoOrder(order)
        setShowCrypto(true)
        return
      }

      if (form.payment === CARD_PAYMENT_METHOD && order.lookupToken) {
        // Hand off to Stripe's hosted page. The order already exists and is
        // `pending_payment`, so abandoning the Stripe page leaves something
        // the customer can settle later rather than losing the basket.
        const pay = await fetch('/api/payments/stripe/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            token: order.lookupToken,
            saveCard,
          }),
        })
        const payData = await pay.json().catch(() => ({}))

        if (pay.ok && payData.clientSecret) {
          // Swap the form for the embedded PaymentElement. No navigation —
          // the customer never leaves the site.
          setCardOrder(order)
          setClientSecret(payData.clientSecret)
          return
        }

        // Stripe unreachable or misconfigured. The order is safe, so say so
        // rather than implying the checkout failed outright.
        router.push('/')
        pushToast({
          title: t('checkout.paymentUnavailable'),
          description: `${order.id} — ${t('orders.awaitingPayment')}`,
          variant: 'default',
        })
        return
      }

      router.push('/')
      pushToast({
        title: t('toast.orderPlaced'),
        description:
          order.paymentStatus === 'pending_payment'
            ? `${order.id} — ${t('orders.awaitingPayment')}`
            : order.id,
        variant: 'success',
      })
    } catch {
      pushToast({ title: t('checkout.orderFailed'), variant: 'default' })
    } finally {
      setSubmitting(false)
    }
  }

  /** Fills the form from the remembered record. Deliberately manual rather
   *  than automatic on open: silently repopulating a form is disorienting,
   *  and someone ordering a gift to another address would have to clear it. */
  function applySaved() {
    const saved = readSavedProfile()
    if (!saved) return
    setForm((prev) => ({
      ...prev,
      name: saved.name,
      email: saved.email,
      phone: saved.phone,
      phoneCountry: saved.phoneCountry as CountryCode,
      street: saved.street,
      postalCode: saved.postalCode,
      city: saved.city,
      country: saved.country as CountryCode,
    }))
    setErrors({})
    pushToast({ title: t('checkout.savedApplied'), variant: 'success' })
  }

  function forgetSaved() {
    clearSavedProfile()
    setHasSaved(false)
    setSaveDetails(false)
    pushToast({ title: t('checkout.savedCleared'), variant: 'default' })
  }

  /**
   * Payment confirmed. This is the ONLY path that leaves /checkout forwards.
   *
   * A hard navigation rather than router.push: the success page must mount
   * against a clean store with the cart already gone, and it also drops the
   * checkout out of the history entry the customer would hit with Back —
   * landing them on an empty-cart guard rather than a re-submittable form.
   */
  function handleCardPaid() {
    if (!cardOrder) return
    window.location.href = `/checkout/success?order=${encodeURIComponent(cardOrder.id)}`
  }

  /** Leaving the card step keeps the order — it becomes an unpaid order
   *  waiting in the personal account, exactly as abandoning crypto does. */
  function handleCardBack() {
    const left = cardOrder
    setCardOrder(null)
    setClientSecret(null)
    router.push('/')
    if (left) {
      pushToast({
        title: t('toast.orderPlaced'),
        description: `${left.id} — ${t('orders.awaitingPayment')}`,
        variant: 'success',
      })
    }
  }

  function handleCryptoPaid() {
    if (cryptoOrder) {
      window.location.href = `/checkout/success?order=${encodeURIComponent(cryptoOrder.id)}`
      return
    }
    router.push('/')
    setShowCrypto(false)
    setCryptoOrder(null)
  }

  /** Leaving the payment screen keeps the order — it simply becomes an
   * unpaid order waiting in the personal account. */
  function handleCryptoBack() {
    setShowCrypto(false)
    router.push('/')
    if (cryptoOrder) {
      pushToast({
        title: t('toast.orderPlaced'),
        description: `${cryptoOrder.id} — ${t('orders.awaitingPayment')}`,
        variant: 'success',
      })
    }
    setCryptoOrder(null)
  }

  const hasErrors = Object.keys(errors).length > 0

  return (
    <>
      <div className="flex w-full flex-col">
        {!currentUser ? (
          /* Checkout requires an account. An order is the anchor for its own
             history, returns and "pay later" — all of which need something
             more durable than a token in one browser's local storage, which is
             lost on a cache clear or a different device. Gating here rather
             than at submit means the customer finds out before typing an
             address, not after. */
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
            <LogIn className="size-8 text-gold/70" strokeWidth={1.25} />
            <div className="space-y-2">
              <h3 className="font-serif text-lg font-semibold text-foreground">
                {t('checkout.signInRequired')}
              </h3>
              <p className="text-[13px] font-light leading-relaxed text-muted-foreground">
                {t('checkout.signInRequiredBody')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanel('user')}
              className="w-full max-w-xs border border-gold/40 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
            >
              {t('checkout.signInCta')}
            </button>
            <button
              type="button"
              onClick={() => {
              router.push('/')
              setPanel('cart')
            }}
              className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60"
            >
              {t('checkout.backToCart')}
            </button>
          </div>
        ) : cardOrder && clientSecret ? (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <p className="mb-4 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {t('orders.payingFor')} <span className="text-foreground">{cardOrder.id}</span>
            </p>
            <StripePayment
              order={cardOrder}
              clientSecret={clientSecret}
              onPaid={handleCardPaid}
              onBack={handleCardBack}
            />
          </div>
        ) : showCrypto && cryptoOrder?.lookupToken ? (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <p className="mb-4 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {t('orders.payingFor')} <span className="text-foreground">{cryptoOrder.id}</span>
            </p>
            <CryptoPayment
              orderId={cryptoOrder.id}
              token={cryptoOrder.lookupToken}
              onPaid={handleCryptoPaid}
              onBack={handleCryptoBack}
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col">
            <div className="flex-1 space-y-5">
              {/* Offered, never applied automatically — a silently repopulated
                  form is disorienting, and someone shipping a gift elsewhere
                  would have to clear it field by field. */}
              {hasSaved && (
                <div className="flex items-center gap-2 border border-gold/25 bg-gold/[0.04] px-3 py-2.5">
                  <button
                    type="button"
                    onClick={applySaved}
                    className="flex flex-1 items-center gap-2 text-left text-[12px] text-gold"
                  >
                    <Wand2 className="size-3.5 shrink-0" strokeWidth={1.5} />
                    {t('checkout.autofill')}
                  </button>
                  <button
                    type="button"
                    onClick={forgetSaved}
                    aria-label={t('checkout.forgetSaved')}
                    title={t('checkout.forgetSaved')}
                    className="flex size-7 shrink-0 items-center justify-center text-muted-foreground/60 transition hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              )}

              <Field
                label={t('checkout.name')}
                value={form.name}
                onChange={(v) => update('name', v)}
                required
                error={errors.name}
                autoComplete="name"
              />

              <FieldShell label={t('checkout.phone')} required error={errors.phone}>
                <PhoneInput
                  country={form.phoneCountry}
                  onCountryChange={(c) => update('phoneCountry', c)}
                  value={form.phone}
                  onChange={(v) => update('phone', v)}
                  error={Boolean(errors.phone)}
                />
              </FieldShell>

              <Field
                label={t('checkout.email')}
                value={form.email}
                onChange={(v) => update('email', v)}
                required
                type="email"
                error={errors.email}
                autoComplete="email"
              />

              {/* Live suggestions. Picking one fills the postcode and city
                  below; typing an address the geocoder has never heard of is
                  still accepted verbatim, so a missing street can never block
                  an order. */}
              <AddressAutocomplete
                label={t('checkout.street')}
                value={form.street}
                onChange={(v) => update('street', v)}
                onPick={(s) => {
                  if (s.postalCode) update('postalCode', s.postalCode)
                  if (s.city) update('city', s.city)
                }}
                country={form.country}
                required
                error={errors.street}
                placeholder={t('checkout.streetPlaceholder')}
              />

              <div className="grid grid-cols-[minmax(0,7rem)_1fr] gap-3">
                <Field
                  label={t('checkout.postalCode')}
                  value={form.postalCode}
                  onChange={(v) => update('postalCode', v)}
                  required
                  error={errors.postalCode}
                  autoComplete="postal-code"
                />
                <Field
                  label={t('checkout.city')}
                  value={form.city}
                  onChange={(v) => update('city', v)}
                  required
                  error={errors.city}
                  autoComplete="address-level2"
                />
              </div>

              <FieldShell label={t('checkout.country')} required>
                <CountrySelect value={form.country} onChange={(c) => update('country', c)} />
              </FieldShell>

              <div>
                <span className="mb-2.5 block text-[11px] uppercase tracking-[0.15em] text-foreground">
                  {t('checkout.payment')}
                </span>
                <div className="space-y-2">
                  {paymentMethods.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => update('payment', method)}
                      className={cn(
                        'flex w-full items-center justify-between border px-4 py-3 text-[13px] font-light transition-all duration-200',
                        form.payment === method
                          ? 'border-gold/40 bg-gold/5 text-gold'
                          : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      {method}
                      {form.payment === method && <Check className="size-4" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-2.5 block text-[11px] uppercase tracking-[0.15em] text-foreground">
                  {t('checkout.promo')}
                </span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.promo}
                    onChange={(e) => update('promo', e.target.value)}
                    placeholder="LUXE10"
                    className={cn(
                      'flex-1 border bg-background px-3 py-2.5 text-[13px] font-light text-foreground outline-none transition focus:border-gold/40',
                      promoError ? 'border-destructive' : 'border-border',
                    )}
                  />
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    className="border border-border px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] text-foreground transition hover:bg-accent"
                  >
                    {t('checkout.applyPromo')}
                  </button>
                </div>
                {appliedPromo && (
                  <p className="mt-2 text-[11px] text-gold">
                    {appliedPromo.code} — {appliedPromo.percent}%
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-border/40 px-6 py-5">
              <div className="mb-2 flex justify-between text-[13px]">
                <span className="font-light text-muted-foreground">{t('cart.subtotal')}</span>
                <span className="font-light text-foreground">{formatPrice(cartSubtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="mb-2 flex justify-between text-[13px]">
                  <span className="font-light text-muted-foreground">{t('checkout.discount')}</span>
                  <span className="font-light text-destructive">−{formatPrice(discount)}</span>
                </div>
              )}
              <div className="mb-2 flex justify-between text-[13px]">
                <span className="font-light text-muted-foreground">{t('cart.shipping')}</span>
                <span className={shippingCost === 0 ? 'font-light text-gold' : 'font-light text-foreground'}>
                  {shippingCost === 0 ? t('cart.free') : formatPrice(shippingCost)}
                </span>
              </div>
              {/* Save toggles. Two separate switches on purpose: agreeing to
                  remember an address is not agreeing to store a payment
                  credential, and bundling them would make the second decision
                  invisible. */}
              <div className="mb-5 space-y-3 border-t border-border/40 pt-4">
                <SaveToggle
                  checked={saveDetails}
                  onChange={setSaveDetails}
                  label={t('checkout.saveDetails')}
                  hint={t('checkout.saveDetailsHint')}
                />
                {form.payment === CARD_PAYMENT_METHOD && (
                  <SaveToggle
                    checked={saveCard}
                    onChange={setSaveCard}
                    label={t('checkout.saveCard')}
                    hint={t('checkout.saveCardHint')}
                  />
                )}
              </div>

              <div className="mb-5 flex justify-between border-t border-border/40 pt-3">
                <span className="text-[12px] uppercase tracking-[0.15em] text-foreground">{t('checkout.total')}</span>
                <span className="font-serif text-xl font-light text-gold">{formatPrice(total)}</span>
              </div>
              {hasErrors && (
                <p className="mb-3 text-[11px] text-destructive">{t('checkout.fillRequired')}</p>
              )}
              {/* Persistent, and carries the server's reason. Sits directly
                  above the button so it is in the eye-line of whoever just
                  pressed it, rather than in a corner toast that fades. */}
              {submitError && (
                <div
                  role="alert"
                  className="mb-3 flex items-start gap-2 border-l-2 border-destructive bg-destructive/5 py-2.5 pl-3 pr-2"
                >
                  <AlertCircle className="mt-px size-3.5 shrink-0 text-destructive" strokeWidth={1.5} />
                  <p className="text-[12px] font-light leading-relaxed text-destructive">
                    {submitError}
                  </p>
                </div>
              )}
              <button
                type="submit"
                disabled={cart.length === 0 || submitting}
                className="w-full border border-gold/30 bg-gold/5 py-4 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
              >
                {t('checkout.placeOrder')}
              </button>

              <TrustBadges />
            </div>
          </form>
        )}
      </div>
    </>
  )
}

/**
 * Minimal switch in the dark-gold aesthetic.
 *
 * A real <input type="checkbox"> underneath, visually hidden rather than
 * replaced: that keeps it focusable, announced correctly by screen readers,
 * and togglable with the spacebar. The gold track is decoration drawn on top.
 */
function SaveToggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'flex h-[18px] w-[32px] items-center border p-[2px] transition-all duration-300',
            'peer-focus-visible:ring-1 peer-focus-visible:ring-gold/60',
            checked ? 'border-gold/60 bg-gold/20' : 'border-border bg-transparent',
          )}
        >
          <span
            className={cn(
              'size-[12px] transition-all duration-300',
              checked ? 'translate-x-[14px] bg-gold' : 'translate-x-0 bg-muted-foreground/40',
            )}
          />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-light leading-snug text-foreground">{label}</span>
        <span className="mt-1 block text-[11px] font-light leading-relaxed text-muted-foreground/70">
          {hint}
        </span>
      </span>
    </label>
  )
}

function FieldShell({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="block">
      <span className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-foreground">
        {label}
        {required && <span className="text-gold/70">*</span>}
      </span>
      {children}
      {error && <span className="mt-1.5 block text-[11px] text-destructive">{error}</span>}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
  error,
  placeholder,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  error?: string
  placeholder?: string
  autoComplete?: string
}) {
  // aria-invalid alone tells a screen reader THAT the field is wrong; without
  // aria-describedby it never reads WHY, so the customer hears "invalid" and
  // has to guess. The id has to be unique per field, hence useId.
  const errorId = useId()

  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-foreground">
        {label}
        {required && <span className="text-gold/70">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'w-full border bg-background px-3 py-3 text-[13px] font-light text-foreground outline-none transition placeholder:text-muted-foreground/40',
          error ? 'border-destructive focus:border-destructive' : 'border-border focus:border-gold/40',
        )}
      />
      {error && (
        <span id={errorId} role="alert" className="mt-1.5 block text-[11px] text-destructive">
          {error}
        </span>
      )}
    </label>
  )
}
