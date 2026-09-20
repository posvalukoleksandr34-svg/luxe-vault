/**
 * The single-language form of a localised catalogue string, for places that
 * render outside any visitor's locale: SEO metadata, JSON-LD, Open Graph
 * images, cron jobs.
 *
 * `primaryText` is the PUBLIC one — a page title, a shared link's preview, a
 * crawler's copy of the catalogue. It answers in the storefront's default
 * language, then the other languages the storefront is published in, and never
 * in Russian: a product whose only name is Russian falls through to
 * `fallback`, which at every call site is the slug or the id. A slug in a
 * browser tab is a gap someone fills in; Cyrillic in the tab of an Italian
 * page is the thing this shop does not do any more.
 *
 * `sourceText` is the INTERNAL one, Russian first — the catalogue's source
 * language and the admin console's. It belongs in alerts and jobs a person at
 * the shop reads, never in a response to a visitor.
 *
 * Both are pure and dependency-free, so they are safe in server components,
 * route handlers and the Edge runtime alike. Neither can import lib/i18n's
 * DEFAULT_LOCALE without pulling the whole dictionary into the Edge bundle,
 * so the order is written out here and this comment is the link between them.
 */

/** Public-facing: English, then the storefront's other languages. Never ru. */
export function primaryText(
  text: Partial<Record<string, string>> | null | undefined,
  fallback = '',
): string {
  if (!text) return fallback
  return text.en || text.it || text.fr || text.de || fallback
}

/** Internal-facing: the catalogue's source language first. */
export function sourceText(
  text: Partial<Record<string, string>> | null | undefined,
  fallback = '',
): string {
  if (!text) return fallback
  return text.ru || text.en || Object.values(text).find((v): v is string => Boolean(v)) || fallback
}
