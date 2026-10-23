import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Page from '@/app/review/[token]/unsubscribe/page'
import { localeParam } from '@/lib/locale-routing'

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params
  if (!localeParam(locale)) notFound()
  return { robots: { index: false, follow: false } }
}

export default Page
