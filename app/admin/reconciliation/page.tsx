import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ReconciliationConsole } from '@/components/admin/reconciliation-console'
import { isAdminRequest } from '@/lib/server/admin-guard'

// Live comparison with Stripe: a cached render would show discrepancies already settled.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Сверка платежей',
  robots: { index: false, follow: false },
}

/**
 * /admin/reconciliation — a shell; the console reads and acts through
 * /api/admin/reconciliation and /api/admin/reconciliation/apply, both behind
 * requireAdmin.
 */
export default async function AdminReconciliationPage() {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  if (!(await isAdminRequest())) redirect('/')
  return <ReconciliationConsole />
}
