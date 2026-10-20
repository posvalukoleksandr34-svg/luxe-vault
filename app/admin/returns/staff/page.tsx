import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { StaffManager } from '@/components/admin/refunds/staff-manager'
import { isAdminRequest } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Сотрудники',
  robots: { index: false, follow: false },
}

export default async function AdminStaffPage() {
  if (!(await isAdminRequest())) redirect('/')
  return <StaffManager />
}
