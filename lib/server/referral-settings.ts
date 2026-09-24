import 'server-only'

import {
  REFERRAL_DISCOUNT_PERCENT,
  REFERRAL_DISCOUNT_RANGE,
  REFERRAL_REWARD_AMOUNT,
  REFERRAL_REWARD_RANGE,
} from '@/lib/referral-program'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The referral programme's two numbers, as the admin set them in
 * /admin/referrals (table referral_settings, migration 0041).
 *
 * FALLBACK: until the migration is applied — or if the read fails — the
 * values are the NEXT_PUBLIC_REFERRAL_* env vars, which is exactly what the
 * programme ran on before. A settings table must never be the reason a
 * checkout cannot price a referral.
 *
 * CACHED for a short while per server instance: the discount is read on every
 * cart preview, and the numbers change a few times a year. An update made in
 * this instance clears the cache at once; another instance picks it up within
 * CACHE_MS.
 */

export type ReferralSettings = {
  friendDiscountPercent: number
  referrerRewardAmount: number
  /** False when these are the env fallback rather than the table. */
  stored: boolean
  updatedAt: string | null
}

export const DISCOUNT_RANGE = REFERRAL_DISCOUNT_RANGE
export const REWARD_RANGE = REFERRAL_REWARD_RANGE

const CACHE_MS = 30_000
let cache: { value: ReferralSettings; at: number } | null = null

// Postgres "undefined table" and PostgREST "not in the schema cache".
const MISSING = new Set(['42P01', 'PGRST205'])

function fallback(): ReferralSettings {
  return {
    friendDiscountPercent: REFERRAL_DISCOUNT_PERCENT,
    referrerRewardAmount: REFERRAL_REWARD_AMOUNT,
    stored: false,
    updatedAt: null,
  }
}

/** `fresh` skips the cache — for the admin page, which is where the values
 *  are changed and must show what the table holds. */
export async function getReferralSettings(options: { fresh?: boolean } = {}): Promise<ReferralSettings> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value

  let value = fallback()
  try {
    const { data, error } = await createAdminClient()
      .from('referral_settings')
      .select('friend_discount_percent, referrer_reward_amount, updated_at')
      .eq('id', true)
      .maybeSingle()
    if (error) {
      if (!MISSING.has(error.code ?? '')) console.error('[referral-settings] read failed:', error.message)
    } else if (data) {
      value = {
        friendDiscountPercent: Number(data.friend_discount_percent),
        referrerRewardAmount: Number(data.referrer_reward_amount),
        stored: true,
        updatedAt: data.updated_at as string,
      }
    }
  } catch (e) {
    console.error('[referral-settings] read failed:', (e as Error).message)
  }

  cache = { value, at: Date.now() }
  return value
}

export type SettingsUpdate = { friendDiscountPercent: number; referrerRewardAmount: number }

/** Saves both numbers. Returns the stored row, or an error the admin can read. */
export async function updateReferralSettings(
  input: SettingsUpdate,
): Promise<{ ok: true; settings: ReferralSettings } | { ok: false; error: string; missing?: boolean }> {
  const { data, error } = await createAdminClient()
    .from('referral_settings')
    .upsert(
      {
        id: true,
        friend_discount_percent: input.friendDiscountPercent,
        referrer_reward_amount: input.referrerRewardAmount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select('friend_discount_percent, referrer_reward_amount, updated_at')
    .single()

  if (error) {
    if (MISSING.has(error.code ?? '')) {
      return { ok: false, missing: true, error: 'Таблица настроек не создана — примените миграцию 0041_referral_admin.sql' }
    }
    console.error('[referral-settings] update failed:', error.message)
    return { ok: false, error: 'Не удалось сохранить настройки' }
  }

  const settings: ReferralSettings = {
    friendDiscountPercent: Number(data.friend_discount_percent),
    referrerRewardAmount: Number(data.referrer_reward_amount),
    stored: true,
    updatedAt: data.updated_at as string,
  }
  cache = { value: settings, at: Date.now() }
  return { ok: true, settings }
}
