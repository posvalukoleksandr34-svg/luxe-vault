import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { ReviewRequestsConsole } from '@/components/admin/review-requests/review-requests-console'
import { isAdminRequest } from '@/lib/server/admin-guard'

// The live queue: a cached render would show a request as scheduled after it went out.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Запросы отзывов',
  robots: { index: false, follow: false },
}

/**
 * /admin/review-requests — a shell; the console reads everything through
 * /api/admin/review-requests/*, where every request is checked for the
 * console session AND the staff member's role.
 */
export default async function AdminReviewRequestsPage() {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  if (!(await isAdminRequest())) redirect('/')
  return (
    <Suspense>
      <ReviewRequestsConsole />
    </Suspense>
  )
}
