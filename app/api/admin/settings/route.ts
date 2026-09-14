import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import { validateShippingSettings } from '@/config/shipping'
import {
  STORE_SETTINGS_TAG,
  readShippingSettingsUncached,
  saveShippingSettings,
} from '@/lib/server/store-settings'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path. The table
// itself only accepts writes from the service role (RLS, migration 0028).

/** The current settings and whether they come from the database or defaults. */
export async function GET() {
  const read = await readShippingSettingsUncached()
  return NextResponse.json(read, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Saves the shipping settings.
 *
 * Body: { shippingPrice, freeShippingThreshold, deliveryTimeframe: { min, max } }
 * — CHF amounts and business days. Takes effect for new orders at once (the
 * server prices every order from these) and on the storefront with the next
 * page render.
 */
export async function PUT(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const parsed = validateShippingSettings(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    await saveShippingSettings(parsed.settings)
  } catch (e) {
    const message = (e as Error).message
    console.error('[admin/settings] save failed:', e)
    const missingTable = /store_settings|does not exist|schema cache/i.test(message)
    return NextResponse.json(
      {
        error: missingTable
          ? 'Таблица store_settings ещё не создана — примените миграцию 0028 в Supabase.'
          : message,
      },
      { status: missingTable ? 503 : 500 },
    )
  }

  revalidateTag(STORE_SETTINGS_TAG)
  revalidatePath('/', 'layout')
  revalidatePath('/api/catalog')
  return NextResponse.json({ settings: parsed.settings, source: 'database' })
}
