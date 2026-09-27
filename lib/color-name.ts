import type { LocalizedText, StorefrontLocale } from '@/lib/types'

/**
 * Colour names as the storefront shows them.
 *
 * A colour's name is free text typed in the admin console, and the console is
 * in Russian, so "Чёрный" is a perfectly normal value. It is also an
 * IDENTIFIER: stock rows (product_variants.color) and cart lines key on it, so
 * it cannot simply be rewritten. What changes is only how it is displayed.
 *
 *  - A name with no Cyrillic ("Onyx", "Ivory", "Black") is shown as typed,
 *    exactly as before: those are the shop's own names for its colours.
 *  - A Russian name is translated when it is a colour word this table knows —
 *    plain ("Серый"), in any gender ("Серая"), or light/dark ("Тёмно-серый").
 *  - A Russian name it does not know is not shown at all. The storefront never
 *    prints Russian (see translate() in lib/i18n.ts), and a line reading
 *    "M" is better than one reading "M · Мокко" to an Italian customer.
 */

const CYRILLIC = /[Ѐ-ӿ]/

/** True when `text` can be shown on the storefront: it has no Russian in it. */
export function isStorefrontText(text: string): boolean {
  return !CYRILLIC.test(text)
}

/** Stems — the word with its adjective ending removed, ё read as е. */
const COLOURS: Record<string, LocalizedText> = {
  черн: { ru: 'Чёрный', en: 'Black', it: 'Nero', fr: 'Noir', de: 'Schwarz' },
  бел: { ru: 'Белый', en: 'White', it: 'Bianco', fr: 'Blanc', de: 'Weiß' },
  сер: { ru: 'Серый', en: 'Grey', it: 'Grigio', fr: 'Gris', de: 'Grau' },
  графитов: { ru: 'Графитовый', en: 'Graphite', it: 'Grafite', fr: 'Graphite', de: 'Graphit' },
  антрацитов: { ru: 'Антрацитовый', en: 'Anthracite', it: 'Antracite', fr: 'Anthracite', de: 'Anthrazit' },
  бежев: { ru: 'Бежевый', en: 'Beige', it: 'Beige', fr: 'Beige', de: 'Beige' },
  песочн: { ru: 'Песочный', en: 'Sand', it: 'Sabbia', fr: 'Sable', de: 'Sand' },
  кремов: { ru: 'Кремовый', en: 'Cream', it: 'Crema', fr: 'Crème', de: 'Creme' },
  молочн: { ru: 'Молочный', en: 'Off-white', it: 'Bianco latte', fr: 'Blanc cassé', de: 'Cremeweiß' },
  коричнев: { ru: 'Коричневый', en: 'Brown', it: 'Marrone', fr: 'Marron', de: 'Braun' },
  шоколадн: { ru: 'Шоколадный', en: 'Chocolate', it: 'Cioccolato', fr: 'Chocolat', de: 'Schokolade' },
  кэмел: { ru: 'Кэмел', en: 'Camel', it: 'Cammello', fr: 'Camel', de: 'Camel' },
  син: { ru: 'Синий', en: 'Blue', it: 'Blu', fr: 'Bleu', de: 'Blau' },
  'темно-син': { ru: 'Тёмно-синий', en: 'Navy', it: 'Blu navy', fr: 'Bleu marine', de: 'Dunkelblau' },
  голуб: { ru: 'Голубой', en: 'Light blue', it: 'Azzurro', fr: 'Bleu clair', de: 'Hellblau' },
  зелен: { ru: 'Зелёный', en: 'Green', it: 'Verde', fr: 'Vert', de: 'Grün' },
  оливков: { ru: 'Оливковый', en: 'Olive', it: 'Oliva', fr: 'Olive', de: 'Oliv' },
  хаки: { ru: 'Хаки', en: 'Khaki', it: 'Cachi', fr: 'Kaki', de: 'Khaki' },
  мятн: { ru: 'Мятный', en: 'Mint', it: 'Menta', fr: 'Menthe', de: 'Mint' },
  красн: { ru: 'Красный', en: 'Red', it: 'Rosso', fr: 'Rouge', de: 'Rot' },
  бордов: { ru: 'Бордовый', en: 'Burgundy', it: 'Bordeaux', fr: 'Bordeaux', de: 'Bordeaux' },
  розов: { ru: 'Розовый', en: 'Pink', it: 'Rosa', fr: 'Rose', de: 'Rosa' },
  пудров: { ru: 'Пудровый', en: 'Powder pink', it: 'Rosa cipria', fr: 'Rose poudré', de: 'Puderrosa' },
  фиолетов: { ru: 'Фиолетовый', en: 'Purple', it: 'Viola', fr: 'Violet', de: 'Lila' },
  сиренев: { ru: 'Сиреневый', en: 'Lilac', it: 'Lilla', fr: 'Lilas', de: 'Flieder' },
  желт: { ru: 'Жёлтый', en: 'Yellow', it: 'Giallo', fr: 'Jaune', de: 'Gelb' },
  оранжев: { ru: 'Оранжевый', en: 'Orange', it: 'Arancione', fr: 'Orange', de: 'Orange' },
  золот: { ru: 'Золотой', en: 'Gold', it: 'Oro', fr: 'Or', de: 'Gold' },
  серебрян: { ru: 'Серебряный', en: 'Silver', it: 'Argento', fr: 'Argent', de: 'Silber' },
  разноцветн: { ru: 'Разноцветный', en: 'Multicolour', it: 'Multicolore', fr: 'Multicolore', de: 'Mehrfarbig' },
  мультиколор: { ru: 'Мультиколор', en: 'Multicolour', it: 'Multicolore', fr: 'Multicolore', de: 'Mehrfarbig' },
}

/** "Light grey", "Grigio chiaro"… `{c}` is the colour as the table has it. */
const SHADES: Record<'светло' | 'темно', Record<StorefrontLocale, (c: string) => string>> = {
  светло: {
    en: (c) => `Light ${c.toLowerCase()}`,
    it: (c) => `${c} chiaro`,
    fr: (c) => `${c} clair`,
    de: (c) => `Hell${c.toLowerCase()}`,
  },
  темно: {
    en: (c) => `Dark ${c.toLowerCase()}`,
    it: (c) => `${c} scuro`,
    fr: (c) => `${c} foncé`,
    de: (c) => `Dunkel${c.toLowerCase()}`,
  },
}

const ENDING = /(ый|ий|ой|ая|яя|ое|ее|ые|ие|ую|юю)$/

function stem(word: string): string {
  return word.toLowerCase().replace(/ё/g, 'е').trim().replace(ENDING, '')
}

/** One Russian colour word ("тёмно-серая"), or '' when it is not one we know. */
function translateWord(word: string, locale: StorefrontLocale): string {
  const key = stem(word)
  const whole = COLOURS[key]
  if (whole) return whole[locale]
  const shade = /^(светло|темно)-(.+)$/.exec(key)
  const base = shade && COLOURS[shade[2]]
  if (shade && base) return SHADES[shade[1] as 'светло' | 'темно'][locale](base[locale])
  return ''
}

/**
 * The colour's name in the visitor's language — see the note at the top.
 * Combinations ("Чёрный/белый", "чёрный и белый") are translated part by part,
 * and shown only when every part is known.
 */
export function colorLabel(name: string, locale: StorefrontLocale): string {
  const trimmed = name.trim()
  if (isStorefrontText(trimmed)) return trimmed
  const parts = trimmed.split(/\s*(?:\/|,|\+|&|\s+и\s+)\s*/).filter(Boolean)
  const translated = parts.map((part) => translateWord(part, locale))
  return translated.every(Boolean) ? translated.join(' / ') : ''
}
