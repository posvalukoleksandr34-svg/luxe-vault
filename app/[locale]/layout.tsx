import { notFound } from 'next/navigation'
import { localeParam } from '@/lib/locale-routing'

/**
 * The language segment: /it, /fr, /de.
 *
 * Its whole job is to reject an unknown language and to correct the document's
 * `lang`. The pages beneath it are the storefront's own, re-exported — the
 * body text follows the URL through the store, which reads it from the path.
 *
 * WHY `lang` IS SET BY A SCRIPT. `<html>` belongs to the root layout, which
 * sits above this segment and therefore cannot see which language was asked
 * for. The alternatives are worse: reading the language from a header in the
 * root layout would call headers(), which opts the WHOLE storefront out of
 * static rendering and costs every page its prerendered HTML; splitting the
 * app into two root layouts would make every step between a localised page and
 * checkout a full page load, in the middle of a purchase.
 *
 * So the attribute is corrected before first paint instead. It is inline and
 * synchronous — it runs before the body is parsed, so no assistive technology
 * ever reads the page under the wrong language. What it does NOT fix is the
 * raw HTML as served: that still says the default language, which is why the
 * language a search engine reads comes from `hreflang` and the content itself
 * (lib/locale-routing.ts), both of which are correct in the source.
 */
export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const locale = localeParam(params.locale)
  if (!locale) notFound()

  return (
    <>
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.lang=${JSON.stringify(locale)}`,
        }}
      />
      {children}
    </>
  )
}
