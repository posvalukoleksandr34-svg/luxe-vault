import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { NewsletterManager } from '@/components/admin/newsletter-manager'
import { isAdminRequest } from '@/lib/server/admin-guard'

// Reachable only with an admin session (middleware.ts). Always fresh: the
// subscriber list and counts are read by the page on every visit.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Рассылка',
  robots: { index: false, follow: false },
}

export default async function AdminNewsletterPage() {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  if (!(await isAdminRequest())) redirect('/')
  return <NewsletterManager />
}
