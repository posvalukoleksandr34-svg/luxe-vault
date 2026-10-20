import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { RefundsConsole } from '@/components/admin/refunds/refunds-console'
import { isAdminRequest } from '@/lib/server/admin-guard'

// The live queue: a cached render would show a case as open after a
// colleague had already decided it.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Возвраты',
  robots: { index: false, follow: false },
}

/**
 * /admin/returns — the refund & return console. The page is a shell: the
 * console reads everything through /api/admin/refunds/*, where every request
 * is checked for the signed-in console session AND the staff member's role.
 */
export default async function AdminReturnsPage() {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  if (!(await isAdminRequest())) redirect('/')
  return (
    <Suspense>
      <RefundsConsole />
    </Suspense>
  )
}
