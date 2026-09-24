import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js'

/**
 * The country list behind the phone field's dial-code picker, and its search.
 *
 * A customer looks for their country the way they would say it, which is not
 * necessarily the language the shop is showing. So every country is findable
 * by its name in the page's language, in English and in Russian — "Укр",
 * "Ukr" and "Ucr" (on the Italian page) all find Ukraine — as well as by its
 * two-letter code, a few everyday short forms (USA, UK, ОАЭ) and its dialling
 * code ("380", "+380").
 *
 * Matching is by the START of a word, not anywhere in it: "ан" should offer
 * Андорра and Ангола, not every name with "ан" in the middle (Иран, Пакистан,
 * Казахстан…). An exact name ranks first ("uk" is the United Kingdom before
 * Ukraine), then the start of the whole name, then the start of a later word,
 * so "Гв" lists Гватемала before Папуа — Новая Гвинея.
 */

export type CountryOption = {
  code: CountryCode
  /** In the page's language — what the list shows. */
  name: string
  dial: string
  /** Every normalised name the country answers to. */
  keys: string[]
}

/** Short forms people type that no display name contains. */
const ALIASES: Partial<Record<CountryCode, string[]>> = {
  US: ['usa', 'america', 'сша', 'америка'],
  GB: ['uk', 'england', 'britain', 'scotland', 'wales', 'англия', 'британия', 'великобритания'],
  AE: ['uae', 'emirates', 'оаэ', 'эмираты'],
  NL: ['holland', 'голландия'],
  CZ: ['czech republic', 'чехия'],
  KR: ['korea', 'корея'],
  KP: ['north korea', 'кндр'],
  CI: ['ivory coast', 'кот-д’ивуар'],
  MM: ['burma', 'бирма'],
  SZ: ['swaziland', 'свазиленд'],
  MK: ['macedonia', 'македония'],
  TR: ['turkey', 'турция'],
}

/** Lower case, no accents, ё as е, and one kind of dash and apostrophe. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ё/g, 'е')
    .replace(/[‐-―−]/g, '-')
    .replace(/[’'`]/g, '’')
    .trim()
}

function displayNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' })
  } catch {
    return null
  }
}

export function buildCountryOptions(locale: string): CountryOption[] {
  const shown = displayNames(locale)
  const en = displayNames('en')
  const ru = displayNames('ru')

  return getCountries()
    .map((code) => {
      const name = shown?.of(code) ?? code
      const names = [name, en?.of(code), ru?.of(code), code, ...(ALIASES[code] ?? [])]
      return {
        code,
        name,
        dial: `+${getCountryCallingCode(code)}`,
        keys: Array.from(new Set(names.filter((n): n is string => Boolean(n)).map(normalise))),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale))
}

/** The query IS a name ("uk", "сша") → 0; the whole name starts with it → 1;
 *  a later word does → 2; no match → null. */
function nameRank(key: string, q: string): number | null {
  if (key === q) return 0
  if (key.startsWith(q)) return 1
  // Word starts: after a space, a hyphen, a bracket or an apostrophe
  // ("Кот-д’Ивуар", "Bosnia & Herzegovina", "Congo (DRC)").
  const words = key.split(/[\s\-(),&’.]+/)
  return words.slice(1).some((w) => w.startsWith(q)) ? 2 : null
}

/**
 * The countries matching `query`, best first; the whole list, in its own
 * order, for an empty query.
 */
export function searchCountries(options: CountryOption[], query: string): CountryOption[] {
  const raw = query.trim()
  if (!raw) return options

  // Digits (with or without the +) are a dialling code: "+7" is Russia and
  // Kazakhstan, "38" is Ukraine and its neighbours.
  const digits = raw.replace(/[\s+()-]/g, '')
  if (/^\d+$/.test(digits)) {
    return options
      .filter((c) => c.dial.slice(1).startsWith(digits))
      .sort((a, b) => Number(b.dial.slice(1) === digits) - Number(a.dial.slice(1) === digits))
  }

  const q = normalise(raw)
  const ranked: { option: CountryOption; rank: number; index: number }[] = []
  options.forEach((option, index) => {
    let best: number | null = null
    for (const key of option.keys) {
      const rank = nameRank(key, q)
      if (rank !== null && (best === null || rank < best)) best = rank
      if (best === 0) break
    }
    if (best !== null) ranked.push({ option, rank: best, index })
  })
  // Stable: equal ranks keep the list's alphabetical order.
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((r) => r.option)
}
