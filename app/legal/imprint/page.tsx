import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { imprintMetadata } from '@/lib/page-seo'
import { ImprintDocument } from '../_content/ImprintDocument'
import { Footer } from '../_shared'

export const metadata: Metadata = imprintMetadata(DEFAULT_LOCALE)

export default function Page() {
  return (
    <>
      <ImprintDocument />
      <Footer />
    </>
  )
}
