/**
 * Currencies: how prices are shown, converted, and charged.
 *
 * Every price in the catalogue, the cart and every order is stored in the
 * BASE currency, CHF — orders.total is always francs. A customer who picks EUR
 * or USD sees prices converted at EXCHANGE_RATES and, paying by card, is
 * CHARGED in that currency: the server converts the stored CHF total with this
 * same table (lib/server/stripe.ts) and records what it charged in
 * orders.payment_currency / payment_amount. Crypto payments stay priced in CHF.
 *
 * Rates are LIVE: lib/server/exchange-rates.ts fetches ECB reference rates
 * (cached for an hour) and installs them with setRates() on the server; the
 * store fetches the same figures from /api/rates and installs them in the
 * browser. EXCHANGE_RATES below is the fallback used until then, or whenever
 * the feed is unreachable. The rate a payment was actually made at stays
 * recoverable from the order itself (payment_amount / total), so a later rate
 * change never re-prices a refund.
 *
 * USDT is a DISPLAY currency: prices can be shown in it (pegged to the US
 * dollar), but a card cannot be charged in it — CARD_CURRENCIES leaves it
 * out, so a card payment falls back to francs and says so, and crypto
 * payments are priced in CHF as before.
 */

import type { Order } from './types'

export type CurrencyCode = 'CHF' | 'EUR' | 'USD' | 'USDT'

/** The fiat currencies a card can be charged in. */
export type CardCurrencyCode = Exclude<CurrencyCode, 'USDT'>

export const BASE_CURRENCY: CardCurrencyCode = 'CHF'

export const CURRENCY_CODES: CurrencyCode[] = ['CHF', 'EUR', 'USD', 'USDT']

export const CARD_CURRENCIES: CardCurrencyCode[] = ['CHF', 'EUR', 'USD']

/** i18n keys for each currency's name, for every currency picker. */
export const CURRENCY_NAME_KEY = {
  CHF: 'currency.CHF',
  EUR: 'currency.EUR',
  USD: 'currency.USD',
  USDT: 'currency.USDT',
} as const

export type ExchangeRates = Record<CurrencyCode, number>

/**
 * Units of each currency per 1 CHF — the FALLBACK table, used until live rates
 * arrive and whenever the feed fails. Refreshed by hand (18 Sept 2026, ECB).
 * The live feed is also sanity-checked against these (lib/server/exchange-rates.ts),
 * so keep them roughly current.
 */
export const EXCHANGE_RATES: ExchangeRates = {
  CHF: 1,
  EUR: 1.06,
  USD: 1.21,
  USDT: 1.21,
}

export const CURRENCY_STORAGE_KEY = 'lv.currency.v1'

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return value === 'CHF' || value === 'EUR' || value === 'USD' || value === 'USDT'
}

export function isCardCurrency(value: unknown): value is CardCurrencyCode {
  return value === 'CHF' || value === 'EUR' || value === 'USD'
}

/**
 * The rates currently in force — module-level, like the active currency
 * below, so every existing convert/format call picks them up without a new
 * parameter. Replaced wholesale by setRates(); never partially.
 */
let activeRates: ExchangeRates = EXCHANGE_RATES

export function getRates(): ExchangeRates {
  return activeRates
}

export function setRates(next: ExchangeRates): void {
  activeRates = next
}

/** Validates a rates object from the network: every currency present, each a
 *  positive finite number, CHF exactly 1. */
export function isExchangeRates(value: unknown): value is ExchangeRates {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return (
    r.CHF === 1 &&
    CURRENCY_CODES.every((code) => typeof r[code] === 'number' && Number.isFinite(r[code]) && (r[code] as number) > 0)
  )
}

/**
 * Rounds to whole cents. The epsilon is what keeps 1.005 from becoming 1.00:
 * in binary it is 1.00499…, and money must round the way people do.
 */
export function roundMinor(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

/**
 * Minor units (cents, rappen) — what Stripe takes. CHF, EUR and USD all have
 * two decimals, so 249.90 is 24990; passing 249.9 would charge 2.49.
 */
export function toMinorUnits(amount: number): number {
  return Math.round(roundMinor(amount) * 100)
}

export function fromMinorUnits(minor: number): number {
  return minor / 100
}

/** An amount in CHF, expressed in another currency at the configured rate. */
export function convertFromChf(
  amountChf: number,
  to: CurrencyCode,
  rates: ExchangeRates = getRates(),
): number {
  return amountChf * (rates[to] ?? 1)
}

/**
 * A CHF amount converted and rounded to the cent: exactly what a card is
 * charged. The checkout total is displayed through this too, so the figure
 * above the Pay button is the figure on the bank statement.
 */
export function chargeAmount(
  amountChf: number,
  currency: CurrencyCode,
  rates: ExchangeRates = getRates(),
): number {
  return roundMinor(convertFromChf(amountChf, currency, rates))
}

function formatIn(value: number, currency: string, fractionDigits: number): string {
  const digits = { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
  // Intl only knows ISO 4217 codes; USDT (and any coin ticker) is laid out the
  // same way by hand — code, space, de-CH grouped figure.
  if (currency.length !== 3) {
    return `${currency} ${new Intl.NumberFormat('de-CH', digits).format(value)}`
  }
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    ...digits,
  }).format(value)
}

/** Cents only when there are any: "EUR 117.59", but "CHF 200". */
function centsIfAny(value: number): number {
  return Math.round(value * 100) % 100 !== 0 ? 2 : 0
}

/**
 * Formats an amount given IN CHF, converted to `currency`.
 *
 * de-CH grouping ("1’000") for every currency, so switching currency changes
 * the code and the figure and nothing else about how a price looks — the
 * site's existing "CHF 1’000" stays exactly as it was. The ISO code rather
 * than a symbol for the same reason, and because "EUR 1’070" cannot be
 * mistaken for the franc price it was converted from.
 */
export function formatMoney(
  amountChf: number,
  currency: CurrencyCode,
  /** To the cent, as charged ("CHF 109.90") — for checkout totals and
   *  statements of what will be paid, where whole units would misstate it. */
  exact = false,
): string {
  if (exact) {
    const value = chargeAmount(amountChf, currency)
    return formatIn(value, currency, centsIfAny(value))
  }
  return formatIn(convertFromChf(amountChf, currency), currency, 0)
}

/**
 * Formats an amount that is ALREADY in `currency` — a recorded charge, not a
 * CHF price. Tolerates codes Intl does not know (a crypto ticker) rather than
 * throwing inside a render.
 */
export function formatCharged(amount: number, currency: string): string {
  const code = (currency || BASE_CURRENCY).toUpperCase()
  try {
    return formatIn(amount, code, centsIfAny(amount))
  } catch {
    return `${code} ${amount.toFixed(2)}`
  }
}

/**
 * What the customer was actually charged for an order, in the currency they
 * paid in.
 *
 * Card payments record it on the order (paymentAmount / paymentCurrency).
 * Everything else falls back to the CHF total: crypto orders, whose
 * paymentCurrency is a coin ticker against a CHF price, and card orders from
 * before multi-currency, which were all charged in francs.
 */
export function orderCharge(
  order: Pick<Order, 'total' | 'paymentProvider' | 'paymentCurrency' | 'paymentAmount'>,
): { amount: number; currency: CurrencyCode; converted: boolean } {
  const code = order.paymentCurrency?.toUpperCase()
  if (order.paymentProvider === 'stripe' && isCardCurrency(code) && order.paymentAmount != null) {
    return { amount: order.paymentAmount, currency: code, converted: code !== BASE_CURRENCY }
  }
  return { amount: order.total, currency: BASE_CURRENCY, converted: false }
}

/**
 * Units of the charged currency per 1 CHF, as this order was actually paid —
 * derived from the order, not today's table, so a refund returns exactly its
 * share of what the customer paid. 1 for anything charged in francs.
 */
export function orderChargeRate(
  order: Pick<Order, 'total' | 'paymentProvider' | 'paymentCurrency' | 'paymentAmount'>,
): number {
  const charge = orderCharge(order)
  if (!charge.converted || !(order.total > 0) || !(charge.amount > 0)) return 1
  return charge.amount / order.total
}

/**
 * The currency prices are currently shown in.
 *
 * Module-level so the existing formatPrice(value) signature — called from
 * sixteen files — keeps working unchanged. The store sets it (from the
 * visitor's saved choice, after hydration) and re-renders its consumers; the
 * server always renders the base currency, so the first paint never differs
 * between server and client.
 */
let active: CurrencyCode = BASE_CURRENCY

export function getActiveCurrency(): CurrencyCode {
  return active
}

export function setActiveCurrency(next: CurrencyCode): void {
  active = next
}
