import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { contactMetadata } from '@/lib/page-seo'
import { ContactPage } from '@/components/contact/contact-page'

export const metadata: Metadata = contactMetadata(DEFAULT_LOCALE)

export default function Page() {
  return <ContactPage />
}
