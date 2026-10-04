import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { aboutMetadata } from '@/lib/page-seo'
import { AboutPage } from '@/components/info/about-page'

export const metadata: Metadata = aboutMetadata(DEFAULT_LOCALE)

export default function Page() {
  return <AboutPage />
}
