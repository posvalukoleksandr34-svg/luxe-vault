/**
 * Display currencies.
 *
 * Every price in the catalogue, the cart and every order is stored in the
 * BASE currency, CHF — and CHF is what the customer is actually charged:
 * the Stripe integration creates PaymentIntents in CHF only. Choosing EUR or
 * USD changes how prices are SHOWN, never what is paid, and the checkout says
 * so before payment.
 *
 * The rates are a config object on purpose. `EXCHANGE_RATES` is the one thing
 * to replace when this moves to a live rates API: fetch the rates, keep the
 * same shape, and every caller of convertFromChf() follows.
 */

export type CurrencyCode = 'CHF' | 'EUR' | 'USD'

export const BASE_CURRENCY: CurrencyCode = 'CHF'

export const CURRENCY_CODES: CurrencyCode[] = ['CHF', 'EUR', 'USD']

/**
 * Units of each currency per 1 CHF.
 *
 * INDICATIVE, set by hand (Sept 2026) — not a live feed. They only ever drive
 * the displayed estimate; the charge is in CHF. Replace this object with the
 * response of a rates API to make the estimates live.
 */
export const EXCHANGE_RATES: Record<CurrencyCode, number> = {
  CHF: 1,
  EUR: 1.07,
  USD: 1.25,
}

export const CURRENCY_STORAGE_KEY = 'lv.currency.v1'

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return value === 'CHF' || value === 'EUR' || value === 'USD'
}

/** An amount in CHF, expressed in another currency at the configured rate. */
export function convertFromChf(
  amountChf: number,
  to: CurrencyCode,
  rates: Record<CurrencyCode, number> = EXCHANGE_RATES,
): number {
  return amountChf * (rates[to] ?? 1)
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
  /** Keep the cents when there are any ("CHF 109.90"), for statements of
   *  what will actually be charged, where rounding would misstate it. */
  exact = false,
): string {
  const value = convertFromChf(amountChf, currency)
  const fractionDigits = exact && Math.round(value * 100) % 100 !== 0 ? 2 : 0
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
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
