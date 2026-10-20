import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PolicyEditor } from '@/components/admin/refunds/policy-editor'
import { isAdminRequest } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Политика возвратов',
  robots: { index: false, follow: false },
}

export default async function AdminRefundPolicyPage() {
  if (!(await isAdminRequest())) redirect('/')
  return <PolicyEditor />
}
