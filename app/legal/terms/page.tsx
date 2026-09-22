import type { Metadata } from 'next'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { legalMetadata } from '@/lib/page-seo'
import { LegalDocument } from '../_content/LegalDocument'
import { TERMS } from '../_content/terms'
import { DraftNotice, Footer } from '../_shared'

// The unprefixed route, so the default language. Its localised twins live at
// app/[locale]/legal/* and name the tab in their own language; both call the
// same builder, which reads the DOCUMENT's own title rather than a hardcoded
// one, so the tab always matches the text <LegalDocument> renders.
export const metadata: Metadata = legalMetadata(TERMS, '/legal/terms', DEFAULT_LOCALE)

export default function Page() {
  return (
    <>
      <DraftNotice />
      <LegalDocument set={TERMS} />
      <Footer />
    </>
  )
}
