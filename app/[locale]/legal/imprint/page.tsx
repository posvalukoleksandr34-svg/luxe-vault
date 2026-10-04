import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Page from '@/app/legal/imprint/page'
import { localeParam } from '@/lib/locale-routing'
import { imprintMetadata, localeStaticParams } from '@/lib/page-seo'

/** /it/legal/imprint and its siblings. */
export const generateStaticParams = localeStaticParams

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return imprintMetadata(locale)
}

export default Page
