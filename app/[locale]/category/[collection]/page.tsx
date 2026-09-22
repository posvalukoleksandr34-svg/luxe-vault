import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CollectionPage from '@/app/category/[collection]/page'
import { localeParam } from '@/lib/locale-routing'
import { collectionMetadataFor, localeStaticParams } from '@/lib/page-seo'

/**
 * /it/category/clothing and its siblings.
 *
 * Only the LANGUAGE is prerendered here, not the collections: a collection is
 * a row an admin can add at any moment, and this route inherits the
 * unprefixed one's `dynamicParams`, so a new one resolves without a redeploy.
 */
export const generateStaticParams = localeStaticParams

export async function generateMetadata({
  params,
}: {
  params: { locale: string; collection: string }
}): Promise<Metadata> {
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return collectionMetadataFor(params.collection, locale)
}

export default CollectionPage
