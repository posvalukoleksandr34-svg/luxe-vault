import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import SubcategoryPage from '@/app/category/[collection]/[subcategory]/page'
import { localeParam } from '@/lib/locale-routing'
import { localeStaticParams, subcategoryMetadataFor } from '@/lib/page-seo'

/** /it/category/clothing/jackets and its siblings. See the collection route
 *  above on why only the language is prerendered. */
export const generateStaticParams = localeStaticParams

export async function generateMetadata({
  params,
}: {
  params: { locale: string; collection: string; subcategory: string }
}): Promise<Metadata> {
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return subcategoryMetadataFor(params.collection, params.subcategory, locale)
}

export default SubcategoryPage
