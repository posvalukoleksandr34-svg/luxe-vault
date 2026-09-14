import 'server-only'

import { unstable_cache } from 'next/cache'
import {
  DEFAULT_SHIPPING_SETTINGS,
  SETTING_KEYS,
  settingsFromRows,
  type ShippingSettings,
} from '@/config/shipping'
import { createAdminClient } from '@/lib/supabase/admin'

/** Revalidated by /api/admin/settings on every save. */
export const STORE_SETTINGS_TAG = 'store-settings'

export type ShippingSettingsRead = {
  settings: ShippingSettings
  /** 'defaults' when nothing is saved yet or the table cannot be read. */
  source: 'database' | 'defaults'
}

async function readShippingSettings(): Promise<ShippingSettingsRead> {
  try {
    const { data, error } = await createAdminClient()
      .from('store_settings')
      .select('key, value')
      .in('key', Object.values(SETTING_KEYS))
    if (error) throw new Error(error.message)
    if (!data?.length) return { settings: DEFAULT_SHIPPING_SETTINGS, source: 'defaults' }
    return { settings: settingsFromRows(data), source: 'database' }
  } catch (e) {
    // Migration 0028 not applied yet, the database unreachable, or the env
    // missing. Checkout must keep working: fall back to config/shipping.ts.
    console.warn('[store-settings] using config/shipping.ts defaults:', (e as Error).message)
    return { settings: DEFAULT_SHIPPING_SETTINGS, source: 'defaults' }
  }
}

/**
 * One read per minute at most, shared by every page render and order. The
 * 60 seconds matches the root layout's revalidate; an admin save does not
 * wait for it — it revalidates the tag.
 */
const readCached = unstable_cache(readShippingSettings, ['shipping-settings'], {
  revalidate: 60,
  tags: [STORE_SETTINGS_TAG],
})

/**
 * The shop's shipping fee, free-shipping threshold and default delivery
 * window. Used for display (via the layout and /api/catalog) and — the part
 * that matters — by the server's own order pricing, so what the customer is
 * charged always follows the admin's current figures.
 */
export async function getShippingSettings(): Promise<ShippingSettings> {
  return (await readCached()).settings
}

/** Uncached, with where the figures came from — for the admin page. */
export function readShippingSettingsUncached(): Promise<ShippingSettingsRead> {
  return readShippingSettings()
}

export async function saveShippingSettings(settings: ShippingSettings): Promise<void> {
  const updated_at = new Date().toISOString()
  const { error } = await createAdminClient()
    .from('store_settings')
    .upsert(
      [
        { key: SETTING_KEYS.shippingPrice, value: settings.shippingPrice, updated_at },
        { key: SETTING_KEYS.freeShippingThreshold, value: settings.freeShippingThreshold, updated_at },
        {
          key: SETTING_KEYS.deliveryTimeframe,
          value: { ...settings.deliveryTimeframe, unit: 'business_days' },
          updated_at,
        },
      ],
      { onConflict: 'key' },
    )
  if (error) throw new Error(error.message)
}
