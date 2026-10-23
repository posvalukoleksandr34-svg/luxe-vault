import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Page from '@/app/review/[token]/page'
import { localeParam } from '@/lib/locale-routing'

/** /it/review/<token> and its siblings — the same page; the text follows the
 *  URL's language through the store. */
export const dynamic = 'force-dynamic'

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params
  if (!localeParam(locale)) notFound()
  return { robots: { index: false, follow: false } }
}

export default Page
