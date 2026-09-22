import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Page from '@/app/legal/terms/page'
import { TERMS } from '@/app/legal/_content/terms'
import { localeParam } from '@/lib/locale-routing'
import { legalMetadata, localeStaticParams } from '@/lib/page-seo'

/** /it/legal/terms and its siblings. The document itself is chosen by
 *  <LegalDocument> from the store's language; this names the tab to match. */
export const generateStaticParams = localeStaticParams

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return legalMetadata(TERMS, '/legal/terms', locale)
}

export default Page
