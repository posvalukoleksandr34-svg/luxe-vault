import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { shippingMetadata } from '@/lib/page-seo'
import { ShippingPage } from '@/components/info/shipping-page'

export const metadata: Metadata = shippingMetadata(DEFAULT_LOCALE)

export default function Page() {
  return <ShippingPage />
}
