import type { Metadata } from 'next'
import { LegalDocument } from '../_content/LegalDocument'
import { REFUNDS } from '../_content/refunds'
import { DraftNotice, Footer } from '../_shared'

// Metadata is emitted at build time and cannot read the client-side locale, so
// it stays in the authoritative language. The visible page is localised by
// <LegalDocument>, which reads the store.
export const metadata: Metadata = {
  title: REFUNDS.ru!.title,
  description: REFUNDS.ru!.description,
  alternates: { canonical: '/legal/refunds' },
}

export default function Page() {
  return (
    <>
      <DraftNotice />
      <LegalDocument set={REFUNDS} />
      <Footer />
    </>
  )
}
