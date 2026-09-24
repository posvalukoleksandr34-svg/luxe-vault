import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ReferralsManager } from '@/components/admin/referrals-manager'
import { isAdminRequest } from '@/lib/server/admin-guard'
import { listReferralsForAdmin } from '@/lib/server/referral-admin'
import { getReferralSettings } from '@/lib/server/referral-settings'

// Always live: the settings are changed here, and the payout list is where
// money is handed over — a cached render could offer to pay a reward twice.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Реферальная программа',
  robots: { index: false, follow: false },
}

/**
 * /admin/referrals — the programme's two numbers, and every invited friend
 * with the reward it earned and whether that reward has been paid out.
 */
export default async function AdminReferralsPage() {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  if (!(await isAdminRequest())) redirect('/')

  const [settings, data] = await Promise.all([getReferralSettings({ fresh: true }), listReferralsForAdmin()])
  return <ReferralsManager settings={settings} data={data} />
}
