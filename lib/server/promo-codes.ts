import 'server-only'

import { randomInt } from 'crypto'
import {
  DEFAULT_APP_WELCOME,
  PROMO_CODE_RE,
  PROMO_LIMITS,
  type AppCodeView,
  type AppWelcomeSettings,
  type PromoCode,
  type PromoKind,
  type PromoSource,
} from '@/lib/promo-codes'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Promo codes: what /admin/promocodes lists, creates and changes, the app's
 * personal code, and the uses that come back when an order is never paid.
 *
 * The codes are rows of `coupons`. Validating and consuming them stays in
 * lib/server/coupons.ts and redeem_coupon() (0015) — this file never decides
 * whether a code applies to a basket.
 *
 * Tolerant of migration 0043 not being applied: the list and the create still
 * work on 0015's columns, and the parts that need 0043 (the app code, giving
 * uses back) report `unavailable` or do nothing, and are logged.
 */

// Postgres undefined table / column / function, and PostgREST's schema-cache
// equivalents.
const MISSING = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'])
const isMissing = (error: { code?: string } | null | undefined) => Boolean(error?.code && MISSING.has(error.code))

type CouponRow = {
  id: string
  code: string
  kind: PromoKind
  value: number | string
  active: boolean
  created_at: string
  expires_at: string | null
  max_redemptions: number | null
  times_used: number
  min_order_total: number | string | null
  user_id: string | null
  valid_for_days?: number | null
  source?: PromoSource | null
}

function toPromo(row: CouponRow): PromoCode {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: Number(row.value),
    active: row.active,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxUses: row.max_redemptions,
    used: row.times_used ?? 0,
    validForDays: row.valid_for_days ?? null,
    minOrderTotal: row.min_order_total === null ? null : Number(row.min_order_total),
    // Before 0043 every code was made by hand.
    source: row.source ?? 'admin',
    userId: row.user_id,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

// ------------------------------------------------------------------ admin --

export type PromoList = {
  codes: PromoCode[]
  /** App codes are one per customer; the list shows the newest and counts. */
  appCodes: { issued: number; used: number; recent: PromoCode[] }
  /** False until 0043 adds valid_for_days / source. */
  migrated: boolean
}

export async function listPromoCodes(): Promise<PromoList> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false }).limit(2000)
  if (error) throw new Error(`Failed to read promo codes: ${error.message}`)

  const rows = (data ?? []) as CouponRow[]
  const migrated = rows.length === 0 ? await hasPromoColumns() : 'source' in rows[0]
  const all = rows.map(toPromo)
  const app = all.filter((p) => p.source === 'app_welcome')
  return {
    codes: all.filter((p) => p.source !== 'app_welcome'),
    appCodes: { issued: app.length, used: app.filter((p) => p.used > 0).length, recent: app.slice(0, 50) },
    migrated,
  }
}

async function hasPromoColumns(): Promise<boolean> {
  const { error } = await createAdminClient().from('coupons').select('source, valid_for_days').limit(1)
  return !error
}

export type PromoInput = {
  code: string
  kind: PromoKind
  value: number
  maxUses: number | null
  /** Either a number of days from now, or an exact moment, or neither. */
  validForDays: number | null
  expiresAt: string | null
  minOrderTotal: number | null
}

export type PromoWriteResult = { ok: true; promo: PromoCode } | { ok: false; error: string; status: number }

/** The input's rules, in Russian — only the admin console calls this. */
export function checkPromoInput(input: PromoInput): string | null {
  if (!PROMO_CODE_RE.test(input.code)) return 'Код: 3–32 символа, латинские буквы, цифры и дефис'
  const range = PROMO_LIMITS[input.kind]
  if (!Number.isFinite(input.value) || input.value < range.min || input.value > range.max) {
    return input.kind === 'percent' ? 'Скидка — от 1 до 100%' : 'Сумма скидки — от 0.01 до 10 000 CHF'
  }
  if (input.maxUses !== null && (!Number.isInteger(input.maxUses) || input.maxUses < PROMO_LIMITS.maxUses.min)) {
    return 'Лимит использований — целое число от 1 (или пусто = без лимита)'
  }
  if (input.validForDays !== null && input.expiresAt !== null) return 'Укажите либо срок в днях, либо дату окончания'
  if (
    input.validForDays !== null &&
    (!Number.isInteger(input.validForDays) || input.validForDays < PROMO_LIMITS.days.min || input.validForDays > PROMO_LIMITS.days.max)
  ) {
    return 'Срок действия — от 1 до 3650 дней'
  }
  if (input.expiresAt !== null) {
    const at = Date.parse(input.expiresAt)
    if (!Number.isFinite(at)) return 'Неверная дата окончания'
    if (at <= Date.now()) return 'Дата окончания уже прошла'
  }
  if (input.minOrderTotal !== null && (!Number.isFinite(input.minOrderTotal) || input.minOrderTotal < 0)) {
    return 'Минимальная сумма заказа не может быть отрицательной'
  }
  return null
}

export async function createPromoCode(input: PromoInput): Promise<PromoWriteResult> {
  const problem = checkPromoInput(input)
  if (problem) return { ok: false, error: problem, status: 400 }

  const expiresAt =
    input.validForDays !== null
      ? new Date(Date.now() + input.validForDays * DAY_MS).toISOString()
      : input.expiresAt
        ? new Date(input.expiresAt).toISOString()
        : null

  const base = {
    code: input.code,
    kind: input.kind,
    value: Math.round(input.value * 100) / 100,
    active: true,
    expires_at: expiresAt,
    max_redemptions: input.maxUses,
    min_order_total: input.minOrderTotal,
  }
  const supabase = createAdminClient()
  let result = await supabase
    .from('coupons')
    .insert({ ...base, valid_for_days: input.validForDays, source: 'admin' })
    .select('*')
    .single()
  // Before 0043: the same code without the two new columns.
  if (result.error && isMissing(result.error)) {
    result = await supabase.from('coupons').insert(base).select('*').single()
  }

  if (result.error) {
    if (result.error.code === '23505') return { ok: false, error: `Код ${input.code} уже существует`, status: 409 }
    console.error('[promo-codes] create failed:', result.error)
    return { ok: false, error: 'Не удалось создать промокод', status: 500 }
  }
  return { ok: true, promo: toPromo(result.data as CouponRow) }
}

export type PromoPatch = {
  active?: boolean
  maxUses?: number | null
  /** An ISO moment, or null to remove the expiry. */
  expiresAt?: string | null
}

export async function updatePromoCode(id: string, patch: PromoPatch): Promise<PromoWriteResult> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.active !== undefined) update.active = patch.active
  if (patch.maxUses !== undefined) {
    if (patch.maxUses !== null && (!Number.isInteger(patch.maxUses) || patch.maxUses < 1)) {
      return { ok: false, error: 'Лимит использований — целое число от 1', status: 400 }
    }
    update.max_redemptions = patch.maxUses
  }
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt !== null && !Number.isFinite(Date.parse(patch.expiresAt))) {
      return { ok: false, error: 'Неверная дата окончания', status: 400 }
    }
    update.expires_at = patch.expiresAt ? new Date(patch.expiresAt).toISOString() : null
  }

  const { data, error } = await createAdminClient().from('coupons').update(update).eq('id', id).select('*').maybeSingle()
  if (error) {
    console.error(`[promo-codes] update of ${id} failed:`, error)
    return { ok: false, error: 'Не удалось сохранить промокод', status: 500 }
  }
  if (!data) return { ok: false, error: 'Промокод не найден', status: 404 }
  return { ok: true, promo: toPromo(data as CouponRow) }
}

/**
 * Deletes a code NOBODY has used. A used code is the record of the discount
 * on real orders (orders.coupon_id); deleting it would blank that link, so
 * the answer is to deactivate it instead.
 */
export async function deletePromoCode(id: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const supabase = createAdminClient()
  const { count, error: countError } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('coupon_id', id)
  if (countError) {
    console.error(`[promo-codes] order check for ${id} failed:`, countError)
    return { ok: false, error: 'Не удалось проверить заказы с этим кодом', status: 500 }
  }
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Код уже применялся в заказах — его можно только выключить', status: 409 }
  }
  const { data, error } = await supabase.from('coupons').delete().eq('id', id).select('id').maybeSingle()
  if (error) {
    console.error(`[promo-codes] delete of ${id} failed:`, error)
    return { ok: false, error: 'Не удалось удалить промокод', status: 500 }
  }
  if (!data) return { ok: false, error: 'Промокод не найден', status: 404 }
  return { ok: true }
}

// ------------------------------------------------------ app welcome code --

const APP_SETTINGS_KEY = 'app_welcome_code'

function sanitiseAppSettings(value: unknown): AppWelcomeSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<AppWelcomeSettings>
  const kind: PromoKind = v.kind === 'fixed' ? 'fixed' : 'percent'
  const range = PROMO_LIMITS[kind]
  const num = (x: unknown, fallback: number, min: number, max: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_APP_WELCOME.enabled,
    kind,
    value: num(v.value, DEFAULT_APP_WELCOME.value, range.min, range.max),
    maxUses: Math.round(num(v.maxUses, DEFAULT_APP_WELCOME.maxUses, 1, 100)),
    validForDays: Math.round(num(v.validForDays, DEFAULT_APP_WELCOME.validForDays, 1, 3650)),
  }
}

export async function getAppWelcomeSettings(): Promise<{ settings: AppWelcomeSettings; stored: boolean }> {
  try {
    const { data, error } = await createAdminClient()
      .from('store_settings')
      .select('value')
      .eq('key', APP_SETTINGS_KEY)
      .maybeSingle()
    if (error) {
      if (!isMissing(error)) console.error('[promo-codes] app settings read failed:', error.message)
      return { settings: DEFAULT_APP_WELCOME, stored: false }
    }
    return data ? { settings: sanitiseAppSettings(data.value), stored: true } : { settings: DEFAULT_APP_WELCOME, stored: false }
  } catch (e) {
    console.error('[promo-codes] app settings read failed:', e)
    return { settings: DEFAULT_APP_WELCOME, stored: false }
  }
}

export async function saveAppWelcomeSettings(input: AppWelcomeSettings): Promise<{ ok: true; settings: AppWelcomeSettings } | { ok: false; error: string }> {
  const settings = sanitiseAppSettings(input)
  const { error } = await createAdminClient()
    .from('store_settings')
    .upsert({ key: APP_SETTINGS_KEY, value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) {
    console.error('[promo-codes] app settings save failed:', error)
    return { ok: false, error: 'Не удалось сохранить настройки кода приложения' }
  }
  return { ok: true, settings }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function newAppCode(): string {
  let s = 'APP-'
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return s
}

function viewOf(p: PromoCode): AppCodeView {
  const expired = Boolean(p.expiresAt && Date.parse(p.expiresAt) <= Date.now())
  const exhausted = p.maxUses !== null && p.used >= p.maxUses
  if (exhausted) return { status: 'used', code: p.code, kind: p.kind, value: p.value, expiresAt: p.expiresAt }
  if (expired || !p.active) return { status: 'expired', code: p.code, kind: p.kind, value: p.value, expiresAt: p.expiresAt }
  return {
    status: 'ready',
    code: p.code,
    kind: p.kind,
    value: p.value,
    expiresAt: p.expiresAt,
    usesLeft: p.maxUses === null ? null : p.maxUses - p.used,
  }
}

async function findAppCode(userId: string): Promise<{ promo: PromoCode | null; missing: boolean }> {
  const { data, error } = await createAdminClient()
    .from('coupons')
    .select('*')
    .eq('user_id', userId)
    .eq('source', 'app_welcome')
    .maybeSingle()
  if (error) {
    if (!isMissing(error)) console.error('[promo-codes] app code lookup failed:', error.message)
    return { promo: null, missing: isMissing(error) }
  }
  return { promo: data ? toPromo(data as CouponRow) : null, missing: false }
}

/**
 * The customer's app code — issued now if they have none and `issue` is set.
 *
 * One per ACCOUNT, not per device or per install: an install cannot be
 * verified by a server, an account can, and the unique index in 0043 makes a
 * second code impossible even when two first launches race. Only the customer
 * it was issued to can redeem it (coupons.user_id, checked by redeem_coupon).
 */
export async function appCodeFor(userId: string, options: { issue: boolean }): Promise<AppCodeView> {
  try {
    const existing = await findAppCode(userId)
    if (existing.missing) return { status: 'unavailable' }
    if (existing.promo) return viewOf(existing.promo)

    const { settings } = await getAppWelcomeSettings()
    if (!settings.enabled) return { status: 'disabled' }
    if (!options.issue) return { status: 'disabled' }

    const supabase = createAdminClient()
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from('coupons')
        .insert({
          code: newAppCode(),
          kind: settings.kind,
          value: settings.value,
          active: true,
          expires_at: new Date(Date.now() + settings.validForDays * DAY_MS).toISOString(),
          max_redemptions: settings.maxUses,
          valid_for_days: settings.validForDays,
          user_id: userId,
          source: 'app_welcome',
        })
        .select('*')
        .single()
      if (!error) return viewOf(toPromo(data as CouponRow))
      if (error.code === '23505') {
        // Either the code collided (retry with another) or a concurrent first
        // launch issued this customer's code a moment ago (read it).
        const raced = await findAppCode(userId)
        if (raced.promo) return viewOf(raced.promo)
        continue
      }
      if (isMissing(error)) return { status: 'unavailable' }
      console.error('[promo-codes] app code issue failed:', error)
      return { status: 'unavailable' }
    }
    return { status: 'unavailable' }
  } catch (e) {
    console.error('[promo-codes] app code failed:', e)
    return { status: 'unavailable' }
  }
}

// --------------------------------------------------- uses that come back --

/** The order will not be paid (cancelled, payment expired): its use comes
 *  back. Idempotent; never throws. */
export async function releaseOrderCoupon(orderNumber: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('release_order_coupon', { p_order_number: orderNumber })
    if (error && !isMissing(error)) console.error(`[promo-codes] release for ${orderNumber} failed:`, error.message)
  } catch (e) {
    console.error(`[promo-codes] release for ${orderNumber} failed:`, e)
  }
}

/** The order was paid after its use had been given back: count it again.
 *  Idempotent; never throws. */
export async function reclaimOrderCoupon(orderNumber: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('reclaim_order_coupon', { p_order_number: orderNumber })
    if (error && !isMissing(error)) console.error(`[promo-codes] reclaim for ${orderNumber} failed:`, error.message)
  } catch (e) {
    console.error(`[promo-codes] reclaim for ${orderNumber} failed:`, e)
  }
}

/** Nightly: uses held by orders unpaid for 48 hours come back. */
export async function releaseStaleCouponHolds(): Promise<number> {
  const { data, error } = await createAdminClient().rpc('release_stale_coupon_holds', {})
  if (error) {
    if (isMissing(error)) return 0
    throw new Error(error.message)
  }
  return Number(data) || 0
}
