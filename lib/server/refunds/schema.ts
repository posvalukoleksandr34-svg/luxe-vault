import 'server-only'

import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Whether migration 0059 (the refund system's tables) is applied.
 *
 * Migrations are applied by hand in this project, so the code can be live
 * before its tables are. Without this check every refund route fails with an
 * opaque 500; with it, staff are told exactly what to do and customers see
 * "temporarily unavailable". Positive answers are remembered for the life of
 * the process (a schema is not un-applied); negative ones are re-checked.
 */
const MISSING = new Set(['42P01', '42703', 'PGRST204', 'PGRST205'])
let ready = false

export async function refundsSchemaReady(): Promise<boolean> {
  if (ready) return true
  const { error } = await createAdminClient().from('refund_transactions').select('id').limit(1)
  if (!error) return (ready = true)
  if (MISSING.has(error.code ?? '')) return false
  throw new Error(`Could not check the refund schema: ${error.message}`)
}

export const STAFF_UNMIGRATED =
  'Система возвратов ещё не активирована: примените миграцию supabase/migrations/0059_refund_cases.sql в Supabase (SQL Editor) — см. docs/refunds/README.md.'

/** A 503 for staff routes when 0059 is missing, else null. */
export async function staffUnmigrated(): Promise<NextResponse | null> {
  if (await refundsSchemaReady()) return null
  console.error('[refunds] migration 0059 is not applied: refund routes are unavailable')
  return NextResponse.json({ error: STAFF_UNMIGRATED, code: 'unmigrated' }, { status: 503 })
}

/** The customer's version: no internals, just "try later". */
export async function customerUnmigrated(): Promise<NextResponse | null> {
  if (await refundsSchemaReady()) return null
  console.error('[refunds] migration 0059 is not applied: refund routes are unavailable')
  return NextResponse.json({ error: 'Returns are temporarily unavailable. Please try again later or contact us.', code: 'unavailable' }, { status: 503 })
}
