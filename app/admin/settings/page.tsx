import type { Metadata } from 'next'
import { ShippingSettingsForm } from '@/components/admin/shipping-settings-form'
import { readShippingSettingsUncached } from '@/lib/server/store-settings'

// Always the saved values, never a cached render: this page is where they
// are changed. Reachable only with an admin session (middleware.ts).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Настройки доставки',
  robots: { index: false, follow: false },
}

export default async function AdminSettingsPage() {
  const { settings, source } = await readShippingSettingsUncached()
  return <ShippingSettingsForm initial={settings} initialSource={source} />
}
