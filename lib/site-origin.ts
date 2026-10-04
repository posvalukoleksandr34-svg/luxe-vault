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
//
// www, not the bare domain: luxe-vault.store answers with a 308 to
// www.luxe-vault.store (docs/BRANDING.md §0), so canonicals, hreflang, the
// sitemap and og:image URLs on the bare domain all pointed at a redirect. The
// live check (scripts/security/check-live.sh) gets 200 from www directly.
// If the primary domain in Vercel is ever switched to the bare domain, set
// NEXT_PUBLIC_SITE_ORIGIN for the build instead of editing this.
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'https://www.luxe-vault.store').replace(/\/$/, '')
