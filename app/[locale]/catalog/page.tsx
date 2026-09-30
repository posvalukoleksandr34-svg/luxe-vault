import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CatalogPage from '@/app/catalog/page'
import { localeParam } from '@/lib/locale-routing'
import { catalogMetadata, localeStaticParams } from '@/lib/page-seo'

/**
 * /it/catalog, /fr/catalog, /de/catalog — the same page as /catalog, in
 * another language.
 *
 * The PAGE is re-exported rather than copied: its body is client components
 * that read the language from the URL through the store, so one component tree
 * serves every language and there is no second copy to keep in step. What this
 * file adds is the half a server decides — title, description, canonical and
 * the hreflang set.
 */
export const generateStaticParams = localeStaticParams

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = localeParam(params.locale)
  if (!locale) notFound()
  return catalogMetadata(locale)
}

export default CatalogPage
