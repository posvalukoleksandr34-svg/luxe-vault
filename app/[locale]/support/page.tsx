import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Page from '@/app/support/page'
import { localeParam } from '@/lib/locale-routing'
import { supportMetadata, localeStaticParams } from '@/lib/page-seo'

/**
 * /it/support and its siblings. `?order=` still works: Next hands searchParams
 * to the re-exported page exactly as it does on the unprefixed route.
 *
 * The PAGE is re-exported rather than copied: its body reads the language from
 * the URL through the store, so one component tree serves every language and
 * there is no second copy to drift. What this file adds is the half a server
 * decides — title, description, canonical and the hreflang set.
 */
export const generateStaticParams = localeStaticParams

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return supportMetadata(locale)
}

export default Page
