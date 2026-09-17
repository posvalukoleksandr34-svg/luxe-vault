import type { Metadata } from 'next'
import { NewsletterManager } from '@/components/admin/newsletter-manager'

// Reachable only with an admin session (middleware.ts). Always fresh: the
// subscriber list and counts are read by the page on every visit.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Рассылка',
  robots: { index: false, follow: false },
}

export default function AdminNewsletterPage() {
  return <NewsletterManager />
}
