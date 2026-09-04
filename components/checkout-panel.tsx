'use client'

import { ArrowLeft, Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CountryCode } from 'libphonenumber-js'
import { CountrySelect } from '@/components/country-select'
import { CryptoPayment } from '@/components/crypto-payment'
import { DEFAULT_COUNTRY, PhoneInput } from '@/components/phone-input'
import { TrustBadges } from '@/components/trust-badges'
import { CRYPTO_PAYMENT_METHOD } from '@/lib/data'
import { rememberOrder } from '@/lib/order-registry'
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

export function CheckoutPanel() {
  const {
    panel,
    setPanel,
    cart,
    cartSubtotal,
    paymentMethods,
    applyPromo,
    clearCart,
    pushToast,
    t,
  } = useStore()

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
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [submitting, setSubmitting] = useState(false)

  // Entering the checkout panel fresh (e.g. after a previous crypto flow
  // completed or was abandoned) should never resume mid-payment.
  useEffect(() => {
    if (panel === 'checkout') {
      setShowCrypto(false)
      setCryptoOrder(null)
      setErrors({})
    }
  }, [panel])

  if (panel !== 'checkout') return null

  const discount = appliedPromo
    ? Math.round((cartSubtotal * appliedPromo.percent) / 100)
    : 0
  const total = cartSubtotal - discount

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

  function handleApplyPromo() {
    const promo = applyPromo(form.promo)
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
        pushToast({ title: t('checkout.orderFailed'), variant: 'default' })
        return
      }

      const order: Order = data.order
      if (order.lookupToken) rememberOrder({ id: order.id, token: order.lookupToken })
      clearCart()

      if (form.payment === CRYPTO_PAYMENT_METHOD && order.lookupToken) {
        // Pay immediately, against the order we just created.
        setCryptoOrder(order)
        setShowCrypto(true)
        return
      }

      setPanel(null)
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

  function handleCryptoPaid() {
    if (cryptoOrder) {
      pushToast({ title: t('toast.orderPlaced'), description: cryptoOrder.id, variant: 'success' })
    }
    setPanel(null)
    setShowCrypto(false)
    setCryptoOrder(null)
  }

  /** Leaving the payment screen keeps the order — it simply becomes an
   * unpaid order waiting in the personal account. */
  function handleCryptoBack() {
    setShowCrypto(false)
    setPanel(null)
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
      <div
        className="animate-fade-in fixed inset-0 z-[60] bg-background/70 backdrop-blur-sm"
        onClick={() => setPanel('cart')}
        aria-hidden
      />
      <div className="animate-slide-in-right fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col border-l border-border bg-popover">
        <div className="flex items-center gap-3 border-b border-border/40 px-6 py-5">
          <button
            type="button"
            onClick={() => setPanel('cart')}
            className="flex size-8 items-center justify-center text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-[18px]" />
          </button>
          <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">
            {t('checkout.title')}
          </h2>
        </div>

        {showCrypto && cryptoOrder?.lookupToken ? (
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
          <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col overflow-y-auto">
            <div className="flex-1 space-y-5 px-6 py-5">
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

              <Field
                label={t('checkout.street')}
                value={form.street}
                onChange={(v) => update('street', v)}
                required
                error={errors.street}
                placeholder={t('checkout.streetPlaceholder')}
                autoComplete="street-address"
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
              <div className="mb-5 flex justify-between border-t border-border/40 pt-3">
                <span className="text-[12px] uppercase tracking-[0.15em] text-foreground">{t('checkout.total')}</span>
                <span className="font-serif text-xl font-light text-gold">{formatPrice(total)}</span>
              </div>
              {hasErrors && (
                <p className="mb-3 text-[11px] text-destructive">{t('checkout.fillRequired')}</p>
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
        className={cn(
          'w-full border bg-background px-3 py-3 text-[13px] font-light text-foreground outline-none transition placeholder:text-muted-foreground/40',
          error ? 'border-destructive focus:border-destructive' : 'border-border focus:border-gold/40',
        )}
      />
      {error && <span className="mt-1.5 block text-[11px] text-destructive">{error}</span>}
    </label>
  )
}
