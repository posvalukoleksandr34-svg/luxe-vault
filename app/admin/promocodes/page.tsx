import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PromoCodesManager } from '@/components/admin/promo-codes-manager'
import { isAdminRequest } from '@/lib/server/admin-guard'
import { getAppWelcomeSettings, listPromoCodes, type PromoList } from '@/lib/server/promo-codes'

// Always live: codes are created and switched off here, and the counts move
// with every order.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Промокоды',
  robots: { index: false, follow: false },
}

/**
 * /admin/promocodes — every promo code with its limit and expiry, a form to
 * make new ones, and the terms of the personal code the installed app gives
 * each customer.
 */
export default async function AdminPromoCodesPage() {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  if (!(await isAdminRequest())) redirect('/')

  let list: PromoList | null = null
  try {
    list = await listPromoCodes()
  } catch (e) {
    console.error('[admin/promocodes] read failed:', e)
  }
  const app = await getAppWelcomeSettings()

  return <PromoCodesManager list={list} appSettings={app.settings} appSettingsStored={app.stored} />
}
