import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Page from '@/app/stylist/page'
import { localeParam } from '@/lib/locale-routing'
import { stylistMetadata, localeStaticParams } from '@/lib/page-seo'

/**
 * /it/stylist and its siblings. Noindex, as on the unprefixed route.
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
  return stylistMetadata(locale)
}

export default Page
