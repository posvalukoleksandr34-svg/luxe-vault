/**
 * The production origin, for everything a search engine is told about this
 * shop. Its own module so client code that needs it (the locale routing the
 * store uses) does not import lib/seo.ts — and with it the whole UI table,
 * every language, that the metadata helpers there read.
 *
 * Three files used to declare the origin for themselves — the root layout, the
 * product page, robots.ts and sitemap.ts — which is three chances for a domain
 * change to leave one of them pointing somewhere else. A canonical that
 * disagrees with the sitemap is the kind of defect that costs weeks: Google
 * takes the disagreement as a signal that neither URL is authoritative.
 *
 * NOT lib/site-url.ts. That resolves per environment, on purpose, so an auth
 * email from a preview deployment returns to that preview. Canonicals, the
 * sitemap and structured data must name the PRODUCTION origin from every
 * environment — a preview build that advertises its own hostname to a crawler
 * is asking to be indexed as a duplicate of the real shop.
 */
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'https://luxe-vault.store').replace(/\/$/, '')
