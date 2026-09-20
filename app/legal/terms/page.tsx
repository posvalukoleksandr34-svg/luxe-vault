import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { LegalDocument } from '../_content/LegalDocument'
import { TERMS } from '../_content/terms'
import { DraftNotice, Footer } from '../_shared'

// Metadata is emitted at build time and cannot read the client-side locale, so
// it stays in the storefront's DEFAULT language — which is what a crawler and
// a shared link get. It used to be the authoritative Russian, which put
// Cyrillic in the browser tab of a page whose body was in Italian. The visible
// page is localised by <LegalDocument>, which reads the store.
export const metadata: Metadata = {
  title: TERMS[DEFAULT_LOCALE]!.title,
  description: TERMS[DEFAULT_LOCALE]!.description,
  alternates: { canonical: '/legal/terms' },
}

export default function Page() {
  return (
    <>
      <DraftNotice />
      <LegalDocument set={TERMS} />
      <Footer />
    </>
  )
}
