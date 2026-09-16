import type { Metadata } from 'next'
import { ContactPage } from '@/components/contact/contact-page'

export const metadata: Metadata = {
  title: 'Help & contact',
  description:
    'Contact the Luxe Vault team by email, form or Telegram, and sign up for new arrivals and limited editions.',
  alternates: { canonical: '/contact' },
}

export default function Page() {
  return <ContactPage />
}
