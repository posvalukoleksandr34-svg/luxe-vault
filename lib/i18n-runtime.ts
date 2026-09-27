import en from '@/lib/ui-dict/en.json'
import { DEFAULT_LOCALE, type UIKey } from '@/lib/i18n'
import type { StorefrontLocale } from '@/lib/types'

/**
 * The UI copy, one language at a time — what the store's t() and tf() read.
 *
 * The table in lib/ui-strings.ts carries every key in five languages, and it
 * used to ship to every visitor: ~69 KB of compressed script, of which one
 * language was ever read. scripts/ui-dictionaries.js resolves it at build into
 * one dictionary per language (fallbacks already applied, exactly as
 * translate() applies them), and this module serves them:
 *
 *   - the default language is bundled — most pages are read in it, and it is
 *     what a page shows before any other has loaded;
 *   - every other language is its own chunk, fetched when a page in it is
 *     opened or the visitor switches to it (loadDictionary);
 *   - on the server all of them are present, so a page renders in any
 *     language without waiting.
 *
 * On the client a dictionary must be LOADED before anything renders in it,
 * or the text would not match the server's HTML. The store handles both cases:
 * the first render of a page suspends until its language arrives (React keeps
 * the server HTML meanwhile), and a switch loads first and changes second.
 */
export type Dictionary = Record<UIKey, string>

const loaded: Partial<Record<StorefrontLocale, Dictionary>> = {
  [DEFAULT_LOCALE]: en as Dictionary,
}

if (process.env.NODE_ENV === 'development') {
  // Development only (the branch is compiled out of production builds): read
  // the source table live, so an edit to lib/ui-strings.ts shows on the next
  // hot reload instead of after the dictionaries are regenerated.
  const { UI } = require('@/lib/ui-strings') as typeof import('@/lib/ui-strings')
  const { translate } = require('@/lib/i18n') as typeof import('@/lib/i18n')
  for (const locale of ['en', 'it', 'fr', 'de'] as const) {
    loaded[locale] = Object.fromEntries(
      Object.entries(UI).map(([key, text]) => [key, translate(text, locale)]),
    ) as Dictionary
  }
} else if (typeof window === 'undefined') {
  // Server only — dropped from the client bundle, where `typeof window` is
  // known at build time. Every language, synchronously.
  loaded.it = require('@/lib/ui-dict/it.json') as Dictionary
  loaded.fr = require('@/lib/ui-dict/fr.json') as Dictionary
  loaded.de = require('@/lib/ui-dict/de.json') as Dictionary
}

/** Each language's chunk. Written out, not computed, so the bundler can see
 *  exactly which files to split. */
const importers: Record<StorefrontLocale, () => Promise<{ default: unknown }>> = {
  en: () => import('@/lib/ui-dict/en.json'),
  it: () => import('@/lib/ui-dict/it.json'),
  fr: () => import('@/lib/ui-dict/fr.json'),
  de: () => import('@/lib/ui-dict/de.json'),
}

const inflight: Partial<Record<StorefrontLocale, Promise<Dictionary>>> = {}

/** The dictionary for this language if it is here already, else undefined. */
export function loadedDictionary(locale: StorefrontLocale): Dictionary | undefined {
  return loaded[locale]
}

/**
 * The dictionary for this language, fetching its chunk the first time. One
 * request per language however many callers ask; a failed fetch is forgotten,
 * so the next ask retries.
 */
export function loadDictionary(locale: StorefrontLocale): Promise<Dictionary> {
  const ready = loaded[locale]
  if (ready) return Promise.resolve(ready)
  if (!inflight[locale]) {
    inflight[locale] = importers[locale]()
      .then((module) => {
        const dictionary = (module.default ?? module) as Dictionary
        loaded[locale] = dictionary
        return dictionary
      })
      .catch((error) => {
        delete inflight[locale]
        throw error
      })
  }
  return inflight[locale]!
}

/** The bundled default-language dictionary: always present. */
export const defaultDictionary = loaded[DEFAULT_LOCALE]!
