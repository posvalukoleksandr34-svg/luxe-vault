import type { Metadata } from 'next'
import { LegalDocument } from '../_content/LegalDocument'
import { PRIVACY } from '../_content/privacy'
import { DraftNotice, Footer } from '../_shared'

// Metadata is emitted at build time and cannot read the client-side locale, so
// it stays in the authoritative language. The visible page is localised by
// <LegalDocument>, which reads the store.
export const metadata: Metadata = {
  title: PRIVACY.ru!.title,
  description: PRIVACY.ru!.description,
  alternates: { canonical: '/legal/privacy' },
}

export default function Page() {
  return (
    <>
      <DraftNotice />
      <LegalDocument set={PRIVACY} />
      <Footer />
    </>
  )
}
