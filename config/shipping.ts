/**
 * Store-wide shipping defaults.
 *
 * The live figures are the admin's — store_settings (migration 0028), edited
 * at /admin/settings and read through getShippingSettings() in
 * lib/server/store-settings.ts. These are what the storefront, the cart, the
 * checkout and the server's own pricing fall back to when no value has been
 * saved yet, or when the database cannot be read.
 *
 * Shared by server and client code: nothing here may import a server-only
 * module.
 */

/** A delivery window in business days (Monday–Friday). */
export type DeliveryTimeframe = { min: number; max: number }

export type ShippingSettings = {
  /** Standard delivery fee in CHF, charged on orders under the threshold. */
  shippingPrice: number
  /** Orders from this amount in CHF (the discounted subtotal) ship free. */
  freeShippingThreshold: number
  /** The default delivery window for products without one of their own. */
  deliveryTimeframe: DeliveryTimeframe
}

export const DEFAULT_SHIPPING_SETTINGS: ShippingSettings = {
  shippingPrice: 25,
  freeShippingThreshold: 200,
  deliveryTimeframe: { min: 10, max: 14 },
}

/** What the admin may save. The check constraint in migration 0028 matches. */
export const SHIPPING_LIMITS = {
  shippingPrice: { min: 0, max: 1000 },
  freeShippingThreshold: { min: 0, max: 100000 },
  businessDays: { min: 1, max: 90 },
} as const

/** The store_settings key for each setting. */
export const SETTING_KEYS = {
  shippingPrice: 'shipping_price',
  freeShippingThreshold: 'free_shipping_threshold',
  deliveryTimeframe: 'delivery_timeframe',
} as const

function isAmount(value: unknown, limits: { min: number; max: number }): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= limits.min &&
    value <= limits.max &&
    // Whole cents: a fee is charged to the cent, never to a fraction of one.
    Math.abs(Math.round(value * 100) - value * 100) < 1e-6
  )
}

export function isDeliveryTimeframe(value: unknown): value is DeliveryTimeframe {
  const v = value as DeliveryTimeframe | null | undefined
  const { min, max } = SHIPPING_LIMITS.businessDays
  return Boolean(
    v &&
      Number.isInteger(v.min) &&
      Number.isInteger(v.max) &&
      v.min >= min &&
      v.max <= max &&
      v.max >= v.min,
  )
}

function toNumber(value: unknown): unknown {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : value
}

/**
 * Settings from store_settings rows, key by key: a missing or malformed row
 * falls back to its own default instead of discarding the others.
 */
export function settingsFromRows(rows: { key: string; value: unknown }[]): ShippingSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const price = toNumber(byKey.get(SETTING_KEYS.shippingPrice))
  const threshold = toNumber(byKey.get(SETTING_KEYS.freeShippingThreshold))
  const raw = byKey.get(SETTING_KEYS.deliveryTimeframe) as Record<string, unknown> | undefined
  const timeframe = raw && { min: toNumber(raw.min), max: toNumber(raw.max) }
  return {
    shippingPrice: isAmount(price, SHIPPING_LIMITS.shippingPrice)
      ? price
      : DEFAULT_SHIPPING_SETTINGS.shippingPrice,
    freeShippingThreshold: isAmount(threshold, SHIPPING_LIMITS.freeShippingThreshold)
      ? threshold
      : DEFAULT_SHIPPING_SETTINGS.freeShippingThreshold,
    deliveryTimeframe: isDeliveryTimeframe(timeframe)
      ? timeframe
      : DEFAULT_SHIPPING_SETTINGS.deliveryTimeframe,
  }
}

/** Checks what the admin form sends. Errors are in Russian: the admin is. */
export function validateShippingSettings(
  input: unknown,
): { ok: true; settings: ShippingSettings } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>
  const price = toNumber(body.shippingPrice)
  const threshold = toNumber(body.freeShippingThreshold)
  const tf = (body.deliveryTimeframe ?? {}) as Record<string, unknown>
  const timeframe = { min: toNumber(tf.min), max: toNumber(tf.max) }

  const p = SHIPPING_LIMITS.shippingPrice
  if (!isAmount(price, p)) {
    return { ok: false, error: `Стоимость доставки — сумма от ${p.min} до ${p.max} CHF, не точнее копейки.` }
  }
  const th = SHIPPING_LIMITS.freeShippingThreshold
  if (!isAmount(threshold, th)) {
    return { ok: false, error: `Порог бесплатной доставки — сумма от ${th.min} до ${th.max} CHF.` }
  }
  const d = SHIPPING_LIMITS.businessDays
  if (!isDeliveryTimeframe(timeframe)) {
    return {
      ok: false,
      error: `Срок доставки — целые рабочие дни от ${d.min} до ${d.max}, и «до» не меньше «от».`,
    }
  }
  return { ok: true, settings: { shippingPrice: price, freeShippingThreshold: threshold, deliveryTimeframe: timeframe } }
}
