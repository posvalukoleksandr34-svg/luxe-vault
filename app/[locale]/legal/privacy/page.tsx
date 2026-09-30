import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Page from '@/app/legal/privacy/page'
import { PRIVACY } from '@/app/legal/_content/privacy'
import { localeParam } from '@/lib/locale-routing'
import { legalMetadata, localeStaticParams } from '@/lib/page-seo'

/** /it/legal/privacy and its siblings. The document itself is chosen by
 *  <LegalDocument> from the store's language; this names the tab to match. */
export const generateStaticParams = localeStaticParams

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return legalMetadata(PRIVACY, '/legal/privacy', locale)
}

export default Page
