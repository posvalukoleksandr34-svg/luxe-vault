import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ProductPage from '@/app/product/[slug]/page'
import { localeParam } from '@/lib/locale-routing'
import { localeStaticParams, productMetadataFor } from '@/lib/page-seo'

/**
 * /it/product/x and its siblings.
 *
 * Only the language is prerendered. Prerendering every product in every
 * language would multiply the build by the size of the catalogue for pages
 * that are already served from the database on demand, exactly as the
 * unprefixed product route is.
 */
export const generateStaticParams = localeStaticParams

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string }
}): Promise<Metadata> {
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return productMetadataFor(params.slug, locale)
}

export default ProductPage
