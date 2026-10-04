import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Page from '@/app/shipping/page'
import { localeParam } from '@/lib/locale-routing'
import { shippingMetadata, localeStaticParams } from '@/lib/page-seo'

/** /it/shipping and its siblings — the same page; the body follows the URL's
 *  language through the store, this sets the matching metadata. */
export const generateStaticParams = localeStaticParams

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return shippingMetadata(locale)
}

export default Page
