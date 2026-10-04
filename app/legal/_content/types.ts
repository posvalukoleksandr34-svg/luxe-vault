import type { Locale } from '@/lib/types'

/**
 * Legal documents as data, not JSX.
 *
 * They were originally hand-written Russian markup, which meant the language
 * switcher had no effect on them — an Italian customer read Russian terms.
 * Modelling them as content keyed by locale makes adding or correcting a
 * translation a data edit rather than a second copy of the page.
 *
 * Inline markup is deliberately a two-rule subset — **bold** and [text](href).
 * Anything richer invites raw HTML into translated strings, which is how a
 * legal page ends up with an XSS hole or a broken tag in one language only.
 */

export type Block =
  | { p: string }
  | { ul: string[] }
  | { ol: string[] }

export type Section = {
  h: string
  blocks: Block[]
}

export type LegalDoc = {
  /** Browser tab + <h1>. */
  title: string
  /** Meta description. */
  description: string
  /** "In force since …" line. */
  effective: string
  sections: Section[]
}

/**
 * Not every locale carries every document. `resolveDoc` falls back rather than
 * rendering an empty page, and the page shows a notice when it does.
 */
export type LegalDocSet = Partial<Record<Locale, LegalDoc>>

/**
 * The version that prevails if translations differ. English: the storefront's
 * default language and the one every document exists in. It was Russian, a
 * language no customer can select on the storefront — the notice then pointed
 * buyers at a text they had no way to read.
 */
export const AUTHORITATIVE_LOCALE: Locale = 'en'

/**
 * Picks the best available document for a locale.
 *
 * Falls back to English rather than to Russian: a French or German reader is
 * far more likely to read English than Russian, and silently serving Cyrillic
 * to someone who chose Deutsch is the bug this module exists to fix.
 */
export function resolveDoc(
  set: LegalDocSet,
  locale: Locale,
): { doc: LegalDoc; resolved: Locale; isFallback: boolean } {
  const exact = set[locale]
  if (exact) return { doc: exact, resolved: locale, isFallback: false }

  const english = set.en
  if (english) return { doc: english, resolved: 'en', isFallback: true }

  // A document set with neither the requested locale nor English is a
  // programming error; the authoritative text is the only safe last resort.
  return {
    doc: set[AUTHORITATIVE_LOCALE]!,
    resolved: AUTHORITATIVE_LOCALE,
    isFallback: true,
  }
}
