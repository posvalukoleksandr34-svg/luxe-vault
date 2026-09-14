import {
  DEFAULT_SHIPPING_SETTINGS,
  type DeliveryTimeframe,
  type ShippingSettings,
} from '@/config/shipping'
import type { Locale, Order, Product } from '@/lib/types'

/**
 * Every delivery, processing and returns window in one place.
 *
 * These numbers were previously hardcoded into translated prose in five
 * languages across i18n, the order tracker, the notification triggers and the
 * legal pages. Changing "20–35 days" meant finding and editing roughly twenty
 * strings, and the audit that produced this file found the inevitable result:
 * the delivery FAQ promised "4–5 business days" while the order tracker said
 * "20–35 days". Both were visible to the same customer.
 *
 * Change a number here and every surface follows.
 */
export const FULFILMENT = {
  /** Supplier lead time — ordering the item and quality-checking it. */
  supply: { min: 20, max: 35 },

  /** Packing and handing the parcel to Swiss Post, after payment clears. */
  dispatch: { min: 2, max: 4 },

  /** Swiss Post transit once dispatched. Region-dependent. */
  transit: { min: 4, max: 5 },

  /** Days to notify of withdrawal after delivery (Policy §2). */
  returnWindowDays: 14,

  /** Bank turnaround on a refund, after it is issued. */
  refund: { min: 5, max: 10 },

  /** Target first response on a support enquiry or refund request. */
  supportReply: { min: 1, max: 2 },
} as const

export type Range = { min: number; max: number }

/**
 * Business days → calendar days.
 *
 * The store's default window is set by the admin in business days (Mon–Fri —
 * store_settings.delivery_timeframe), while per-product windows, order stamps
 * and the product schema are calendar days. Every five working days span a
 * weekend: the near end counts whole weekends only and the far end rounds them
 * up, so the latest date is never promised early. 10–14 business days → 14–20.
 */
export function businessToCalendarDays(range: DeliveryTimeframe): Range {
  return {
    min: range.min + 2 * Math.floor(range.min / 5),
    max: range.max + 2 * Math.ceil(range.max / 5),
  }
}

// ---------------------------------------------------- per-product estimates

/**
 * The delivery estimate a product shows when it has none of its own.
 *
 * Each product can carry its own window — Product.deliveryDays, set in the
 * admin panel — because dropshipped lines ship on their supplier's schedule,
 * and one store-wide figure over-promises some pieces and under-sells others.
 * The store-wide figure is the admin's delivery timeframe (store_settings);
 * this is its config/shipping.ts fallback in calendar days. Callers holding
 * the live settings pass businessToCalendarDays(settings.deliveryTimeframe).
 */
export const DEFAULT_DELIVERY_DAYS: Range = businessToCalendarDays(
  DEFAULT_SHIPPING_SETTINGS.deliveryTimeframe,
)

/** What a per-product estimate may be, in whole days. Mirrors the check
 *  constraint in migration 0026. */
export const DELIVERY_DAYS_LIMITS = { min: 1, max: 120 } as const

export function isDeliveryDays(value: unknown): value is Range {
  const v = value as Range | null | undefined
  return Boolean(
    v &&
      Number.isInteger(v.min) &&
      Number.isInteger(v.max) &&
      v.min >= DELIVERY_DAYS_LIMITS.min &&
      v.max <= DELIVERY_DAYS_LIMITS.max &&
      v.max >= v.min,
  )
}

/** A product's own window, or the store default. */
export function deliveryDaysFor(
  product: Pick<Product, 'deliveryDays'> | null | undefined,
  storeDefault: Range = DEFAULT_DELIVERY_DAYS,
): Range {
  return product && isDeliveryDays(product.deliveryDays) ? product.deliveryDays : storeDefault
}

/**
 * The window for a whole basket. An order is complete when its slowest piece
 * arrives, so both ends come from the slowest product: promising the fastest
 * item's date for a parcel that is waiting on a slower one would be wrong for
 * the customer who reads it.
 */
export function basketDeliveryDays(
  products: Pick<Product, 'deliveryDays'>[],
  storeDefault: Range = DEFAULT_DELIVERY_DAYS,
): Range {
  if (products.length === 0) return storeDefault
  let min = 0
  let max = 0
  for (const p of products) {
    const d = deliveryDaysFor(p, storeDefault)
    if (d.min > min) min = d.min
    if (d.max > max) max = d.max
  }
  return { min, max }
}

const ABOUT: Record<Locale, string> = {
  ru: 'около',
  en: 'about',
  it: 'circa',
  fr: 'environ',
  de: 'etwa',
}

const UNIT_WORDS: Record<Exclude<Locale, 'ru'>, { day: [string, string]; week: [string, string] }> = {
  en: { day: ['day', 'days'], week: ['week', 'weeks'] },
  it: { day: ['giorno', 'giorni'], week: ['settimana', 'settimane'] },
  fr: { day: ['jour', 'jours'], week: ['semaine', 'semaines'] },
  de: { day: ['Tag', 'Tage'], week: ['Woche', 'Wochen'] },
}

/**
 * Russian needs three counting forms (1 день, 2 дня, 5 дней) and, after
 * "около", the genitive (около 1 дня, около 14 дней) — a single "{n} дней"
 * string reads wrong for half of all numbers.
 */
function russianUnit(unit: 'day' | 'week', n: number, afterAbout: boolean): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const one = mod10 === 1 && mod100 !== 11
  const few = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
  if (unit === 'day') {
    if (afterAbout) return one ? 'дня' : 'дней'
    return one ? 'день' : few ? 'дня' : 'дней'
  }
  if (afterAbout) return one ? 'недели' : 'недель'
  return one ? 'неделя' : few ? 'недели' : 'недель'
}

function unitWord(locale: Locale, unit: 'day' | 'week', n: number, afterAbout: boolean): string {
  if (locale === 'ru') return russianUnit(unit, n, afterAbout)
  const [singular, plural] = UNIT_WORDS[locale][unit]
  return n === 1 ? singular : plural
}

/**
 * A delivery window as words in the visitor's language: "10–14 дней",
 * "circa 2 settimane", "3–4 Wochen".
 *
 * Whole weeks are said as weeks — "about 2 weeks" is how a two-week
 * dropshipping lead time is actually spoken — and a single figure as "about
 * N", because a delivery date is never exact. The numbers are the admin's;
 * only the wording is generated.
 */
export function describeDeliveryDays(range: Range, locale: Locale): string {
  const weeks = range.min >= 7 && range.min % 7 === 0 && range.max % 7 === 0
  const unit = weeks ? 'week' : 'day'
  const a = weeks ? range.min / 7 : range.min
  const b = weeks ? range.max / 7 : range.max
  if (a === b) return `${ABOUT[locale]} ${a} ${unitWord(locale, unit, a, true)}`
  return `${a}–${b} ${unitWord(locale, unit, b, false)}`
}

const BUSINESS_DAY_WORDS: Record<Exclude<Locale, 'ru'>, [string, string]> = {
  en: ['business day', 'business days'],
  it: ['giorno lavorativo', 'giorni lavorativi'],
  fr: ['jour ouvré', 'jours ouvrés'],
  de: ['Werktag', 'Werktage'],
}

/** 1 рабочий день, 2 рабочих дня, 5 рабочих дней; after «около» the genitive. */
function russianBusinessDays(n: number, afterAbout: boolean): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const one = mod10 === 1 && mod100 !== 11
  const few = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
  if (afterAbout) return one ? 'рабочего дня' : 'рабочих дней'
  return one ? 'рабочий день' : few ? 'рабочих дня' : 'рабочих дней'
}

/**
 * The store's delivery timeframe as words in the visitor's language:
 * "10–14 business days", "10–14 рабочих дней", "10–14 giorni lavorativi".
 * The numbers are the admin's (store_settings); only the wording is generated,
 * so one saved value reads correctly in all five languages.
 */
export function describeBusinessDays(range: DeliveryTimeframe, locale: Locale): string {
  const { min: a, max: b } = range
  const word = (n: number, afterAbout: boolean) => {
    if (locale === 'ru') return russianBusinessDays(n, afterAbout)
    const [singular, plural] = BUSINESS_DAY_WORDS[locale]
    return n === 1 ? singular : plural
  }
  if (a === b) return `${ABOUT[locale]} ${a} ${word(a, true)}`
  return `${a}–${b} ${word(b, false)}`
}

/**
 * A product's delivery window in words: its own (calendar days) when the
 * admin set one, otherwise the store's business-day timeframe.
 */
export function describeProductDelivery(
  product: Pick<Product, 'deliveryDays'>,
  timeframe: DeliveryTimeframe,
  locale: Locale,
): string {
  return isDeliveryDays(product.deliveryDays)
    ? describeDeliveryDays(product.deliveryDays, locale)
    : describeBusinessDays(timeframe, locale)
}

function addDays(from: number, days: number): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Projected delivery window for a specific order.
 *
 * Driven by status and the timestamps the database already stamps, so the
 * estimate tightens as the order advances rather than repeating one static
 * sentence for a month:
 *
 *   pending / processing  → createdAt + the full window
 *   shipped               → shippedAt + transit only (the wait is nearly over)
 *   delivered             → the actual delivery date, not an estimate
 *   cancelled / refunded   → null; there is nothing arriving
 */
export function estimateDelivery(
  order: Pick<Order, 'status' | 'createdAt' | 'shippedAt' | 'deliveredAt'>,
  storeDefault: Range = DEFAULT_DELIVERY_DAYS,
): { earliest: Date; latest: Date; exact?: Date } | null {
  if (order.status === 'cancelled' || order.status === 'refunded') return null

  if (order.status === 'delivered' && order.deliveredAt) {
    const d = new Date(order.deliveredAt)
    return { earliest: d, latest: d, exact: d }
  }

  if (order.status === 'shipped' && order.shippedAt) {
    return {
      earliest: addDays(order.shippedAt, FULFILMENT.transit.min),
      latest: addDays(order.shippedAt, FULFILMENT.transit.max),
    }
  }

  return {
    earliest: addDays(order.createdAt, storeDefault.min),
    latest: addDays(order.createdAt, storeDefault.max),
  }
}

/**
 * "12 – 27 October" style range, collapsing to one date when both ends match.
 *
 * Uses the customer's locale via Intl rather than a hand-built string: month
 * names and day/month order differ across the five languages this site ships,
 * and getting that wrong on a delivery date is worse than showing nothing.
 */
export function formatDeliveryWindow(
  window: { earliest: Date; latest: Date; exact?: Date },
  locale: string,
): string {
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
  if (window.exact) return fmt.format(window.exact)

  const a = fmt.format(window.earliest)
  const b = fmt.format(window.latest)
  return a === b ? a : `${a} — ${b}`
}


/**
 * The one delivery option: standard. Express was removed — it promised a
 * shorter supplier leg the shop cannot guarantee on dropshipped lines.
 * (`orders.shipping_type` keeps its enum for old rows; new orders are always
 * 'standard'.)
 */
export type ShippingType = 'standard'

/**
 * What delivery costs: the admin's fee and free-shipping threshold
 * (store_settings, edited at /admin/settings; config/shipping.ts until one is
 * saved). Only orders UNDER the threshold pay, so a basket of exactly the
 * threshold ships free.
 *
 * The threshold applies to the discounted subtotal, not the total: free
 * shipping earned by a large order should not evaporate because the order also
 * qualified for a discount code.
 *
 * The rule is a required argument, not a module constant, so no caller can
 * price delivery from a stale hardcoded figure: the client passes the store's
 * `shipping`, the server passes getShippingSettings().
 */
export type ShippingRule = Pick<ShippingSettings, 'shippingPrice' | 'freeShippingThreshold'>

/**
 * Tax rate applied to an order.
 *
 * Zero, deliberately. The shop trades as a Swiss Privatverkauf — a private
 * individual, not VAT-registered and below the CHF 100k registration
 * threshold — so it must not charge or display VAT. See migration 0014.
 *
 * If the seller registers, set this to 0.081 and the line appears everywhere
 * at once; nothing else needs to change.
 */
export const TAX_RATE = 0

/**
 * The delivery charge for a basket, computed server-side.
 *
 * Takes the already-discounted subtotal so the free-shipping threshold is
 * applied to what the customer is actually spending.
 */
export function quoteShipping(discountedSubtotal: number, rule: ShippingRule): number {
  return discountedSubtotal >= rule.freeShippingThreshold ? 0 : rule.shippingPrice
}

/**
 * How much more the customer needs to spend to earn free shipping.
 *
 * Returns null when the threshold is already met, so the caller renders
 * nothing rather than "0 CHF to go".
 */
export function freeShippingGap(
  discountedSubtotal: number,
  rule: ShippingRule,
): { remaining: number; threshold: number } | null {
  if (discountedSubtotal >= rule.freeShippingThreshold) return null
  return {
    remaining: Math.round((rule.freeShippingThreshold - discountedSubtotal) * 100) / 100,
    threshold: rule.freeShippingThreshold,
  }
}

/**
 * The window to STAMP on a new order.
 *
 * Called once, server-side, at creation, with the basket's own window (see
 * basketDeliveryDays). Everything afterwards reads the stored dates — see
 * migration 0011 for why the promise is frozen rather than recomputed on
 * every render.
 */
export function quoteDeliveryWindow(
  createdAt: number,
  days: Range = DEFAULT_DELIVERY_DAYS,
): { min: Date; max: Date } {
  return { min: addDays(createdAt, days.min), max: addDays(createdAt, days.max) }
}

// ------------------------------------------------------------------ couriers

/**
 * Tracking deep-links, keyed by a normalised carrier name.
 *
 * A number alone makes the customer find the carrier's site and paste it; a
 * link is the difference between "we told you" and "you can check". Unknown
 * carriers simply render the number with no link rather than guessing a URL
 * that 404s.
 */
const COURIERS: { match: RegExp; label: string; url: (n: string) => string }[] = [
  {
    match: /swiss\s*post|die\s*post|la\s*poste|post\.ch/i,
    label: 'Swiss Post',
    url: (n) => `https://service.post.ch/ekp-web/ui/entry/search/${encodeURIComponent(n)}`,
  },
  {
    match: /dhl/i,
    label: 'DHL',
    url: (n) => `https://www.dhl.com/ch-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  },
  {
    match: /\bups\b/i,
    label: 'UPS',
    url: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  },
  {
    match: /fedex/i,
    label: 'FedEx',
    url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  },
  {
    match: /\bdpd\b/i,
    label: 'DPD',
    url: (n) => `https://tracking.dpd.de/status/en_US/parcel/${encodeURIComponent(n)}`,
  },
  {
    // Matches the Latin and Cyrillic spellings, and the "NP" the label is
    // often abbreviated to — an admin typing "Нова Пошта" must get the same
    // deep-link as one typing "Nova Poshta".
    match: /nova\s*posh?ta|нова\s*пошта|новая\s*почта|\bnp\b/i,
    label: 'Nova Poshta',
    url: (n) => `https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(n)}`,
  },
  {
    // Cyrillic spellings too, for the same reason as Nova Poshta above: the
    // admin types whatever is printed on the label in front of them.
    match: /meest|міст експрес|меест/i,
    label: 'Meest',
    url: (n) => `https://meest.com/tracking/?barcode=${encodeURIComponent(n)}`,
  },
]

/** Known carrier names, for the admin's picker. */
export const COURIER_NAMES = COURIERS.map((c) => c.label)

export function courierTrackingUrl(
  courier: string | undefined,
  trackingNumber: string | undefined,
): { label: string; url: string } | null {
  if (!courier?.trim() || !trackingNumber?.trim()) return null
  const hit = COURIERS.find((c) => c.match.test(courier))
  if (!hit) return null
  return { label: hit.label, url: hit.url(trackingNumber.trim()) }
}
