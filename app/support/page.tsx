import type { Metadata } from 'next'
import { SupportPage } from '@/components/support/support-page'

export const metadata: Metadata = {
  title: 'Support',
  description:
    'Help with orders, payment, shipping, returns and sizes — and a direct line to the Luxe Vault team.',
  alternates: { canonical: '/support' },
}

export default function Page() {
  return <SupportPage />
}
