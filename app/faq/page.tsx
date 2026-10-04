import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { faqMetadata } from '@/lib/page-seo'
import { FaqPage } from '@/components/info/faq-page'

export const metadata: Metadata = faqMetadata(DEFAULT_LOCALE)

export default function Page() {
  return <FaqPage />
}
