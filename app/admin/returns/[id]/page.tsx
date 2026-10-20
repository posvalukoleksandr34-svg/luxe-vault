import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { CaseView } from '@/components/admin/refunds/case-view'
import { isAdminRequest } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Заявка на возврат',
  robots: { index: false, follow: false },
}

/** One refund case for staff. Data and actions go through /api/admin/refunds/cases/[id]. */
export default async function AdminRefundCasePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  if (!(await isAdminRequest())) redirect('/')
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/admin/returns')
  return <CaseView id={id} />
}
