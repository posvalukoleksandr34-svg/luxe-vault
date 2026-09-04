import type { Metadata } from 'next'
import { AdminPanel } from '@/components/admin/admin-panel'

// Never indexed and never linked from the storefront — reachable only by a
// visitor who already holds a valid admin session (see middleware.ts).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AdminPage() {
  return <AdminPanel />
}
