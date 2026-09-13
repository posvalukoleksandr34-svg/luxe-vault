import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Locale } from '@/lib/types'

/**
 * The storefront language an order was placed in (orders.locale, migration
 * 0027), so the emails about it arrive in that language.
 *
 * Its own module, not orders-store: the lifecycle email sender reads it, and
 * orders-store already imports that sender — keeping this apart avoids a
 * circular import. Tolerant of the column not existing yet: before 0027 is
 * applied the write is skipped, the read answers null, and emails fall back
 * to English — the same as before this existed.
 */

const LOCALES = ['ru', 'en', 'it', 'fr', 'de']

let columnMissing = false

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    (/locale/i.test(error.message ?? '') && /column/i.test(error.message ?? ''))
  )
}

function noteMissing(): void {
  if (columnMissing) return
  columnMissing = true
  console.warn('[orders] orders.locale is missing — apply migration 0027 for localised order emails.')
}

export async function setOrderLocale(orderId: string, locale: unknown): Promise<void> {
  const value = typeof locale === 'string' ? locale.toLowerCase().slice(0, 2) : ''
  if (columnMissing || LOCALES.indexOf(value) === -1) return
  const { error } = await createAdminClient().from('orders').update({ locale: value }).eq('order_number', orderId)
  if (!error) return
  if (isMissingColumn(error)) noteMissing()
  else console.warn(`[orders] could not record the language of ${orderId}: ${error.message}`)
}

export async function getOrderLocale(orderId: string): Promise<Locale | null> {
  if (columnMissing) return null
  const { data, error } = await createAdminClient()
    .from('orders')
    .select('locale')
    .eq('order_number', orderId)
    .maybeSingle()
  if (error) {
    if (isMissingColumn(error)) noteMissing()
    return null
  }
  const value = (data as { locale?: string | null } | null)?.locale
  return value && LOCALES.indexOf(value) !== -1 ? (value as Locale) : null
}
