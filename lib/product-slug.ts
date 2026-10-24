import type { LocalizedText } from '@/lib/types'

/**
 * The address of a NEW product: /product/cashmere-coat-x7k2 rather than
 * /product/p-1729684523117. Readable in an order, in a link someone shares and
 * to a search engine. Existing products keep theirs — orders and reviews
 * point at the slug, so it never changes after creation.
 *
 * From the English name when there is one (the URL is not localised), else
 * the first other language, transliterated. A short random tail keeps two
 * products with the same name apart; the API refuses a duplicate anyway.
 */

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function slugifyName(text: string, maxLength = 60): string {
  const latin = text
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => CYRILLIC[ch] ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (latin.length <= maxLength) return latin
  // Cut at a word boundary where there is one.
  const cut = latin.slice(0, maxLength)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > maxLength / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, '')
}

function randomTail(length = 4): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function productSlug(name: Partial<LocalizedText>, tail: string = randomTail()): string {
  const source = [name.en, name.it, name.fr, name.de, name.ru].find((v) => typeof v === 'string' && v.trim()) ?? ''
  const base = slugifyName(source)
  return base ? `${base}-${tail}` : `p-${tail}${Date.now().toString(36)}`
}
