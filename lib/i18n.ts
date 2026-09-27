import type { CategoryKey, Locale, LocalizedText, StatusKey, StorefrontLocale } from './types'
import type { ColorFamily, Fit, Occasion, StyleKey } from './stylist/types'
import type { UI } from './ui-strings'

/**
 * TWO LANGUAGE SETTINGS, ONE DICTIONARY.
 *
 * The storefront and the admin console are localised independently, and this
 * module is the only place the two meet:
 *
 *   STOREFRONT_LOCALES / DEFAULT_LOCALE — what a visitor can choose and what
 *     they get before they choose. Russian is not among them and cannot be:
 *     storefront state is typed `StorefrontLocale`, which excludes it.
 *   ADMIN_LOCALE — the console, always Russian, whatever the storefront is
 *     set to. lib/admin-i18n.ts binds the dictionary to it; the console never
 *     reads the store's `locale`.
 *
 * The `ru` entries in lib/ui-strings.ts therefore stay. They are not dead
 * copy — they are the console's entire interface, and the catalogue is
 * authored in them. What changed is that nothing public can reach them: see
 * `translate()`, and lib/i18n-runtime.ts, which gives the storefront one
 * language at a time.
 */

/** Every language the DICTIONARY carries, storefront and console alike. */
export const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: 'ru', label: 'Русский', flag: 'RU' },
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'it', label: 'Italiano', flag: 'IT' },
  { code: 'fr', label: 'Français', flag: 'FR' },
  { code: 'de', label: 'Deutsch', flag: 'DE' },
]

/** What the storefront's language pickers offer — LOCALES minus Russian. */
export const STOREFRONT_LOCALES = LOCALES.filter(
  (l): l is { code: StorefrontLocale; label: string; flag: string } => l.code !== 'ru',
)

/** The storefront before anyone chooses: English, the one language every
 *  translation in this file is guaranteed to have. */
export const DEFAULT_LOCALE: StorefrontLocale = 'en'

/** The admin console, fixed. Not a default and not a preference: the console
 *  is written in Russian and has no language picker. */
export const ADMIN_LOCALE: Locale = 'ru'

export const LOCALE_STORAGE_KEY = 'luxe-vault-locale'

export function isStorefrontLocale(value: unknown): value is StorefrontLocale {
  return STOREFRONT_LOCALES.some((l) => l.code === value)
}

/**
 * Anything arriving from outside — localStorage, a database column, an email
 * preference stored years ago — narrowed to a language the storefront may
 * actually show. A stored 'ru' becomes the default rather than an error: the
 * visitor keeps their session, they just stop being shown Russian.
 */
export function toStorefrontLocale(value: unknown): StorefrontLocale {
  return isStorefrontLocale(value) ? value : DEFAULT_LOCALE
}

/**
 * Text in `locale`, or the best fallback. An EMPTY string counts as missing —
 * `??` alone let a blank translation through and printed nothing.
 *
 * The chain for a storefront locale never reaches Russian, even as a last
 * resort. It used to: English, then Russian, then the rest — which meant one
 * untranslated product or one missed key printed Cyrillic at an Italian
 * customer. A gap now shows the nearest European language, and an entry that
 * exists ONLY in Russian shows nothing at all on the storefront, which is the
 * intended outcome: an empty label is a bug someone fixes, whereas Cyrillic in
 * an Italian page is a bug everyone lives with.
 *
 * Russian is reachable on one path only — asking for it by name, which just
 * `ADMIN_LOCALE` does.
 */
export function translate(
  text: LocalizedText | Partial<LocalizedText> | null | undefined,
  locale: Locale,
): string {
  if (!text) return ''
  const has = (l: Locale) => typeof text[l] === 'string' && (text[l] as string).trim() !== ''
  const order: Locale[] =
    locale === 'ru' ? ['ru', 'en', 'it', 'fr', 'de'] : [locale, 'en', 'it', 'fr', 'de']
  for (const l of order) if (has(l)) return text[l] as string
  return ''
}

export const CATEGORY_LABELS: Record<CategoryKey, LocalizedText> = {
  // The product types, which are CATEGORIES under a department since 0040.
  // The fine-grained entries below them are kept: they are still what a
  // product is tagged with today, and they are what the stylist and the
  // search read.
  clothing: { ru: 'Одежда', en: 'Clothing', it: 'Abbigliamento', fr: 'Vêtements', de: 'Kleidung' },
  shoes: { ru: 'Обувь', en: 'Shoes', it: 'Scarpe', fr: 'Chaussures', de: 'Schuhe' },
  accessories: { ru: 'Аксессуары', en: 'Accessories', it: 'Accessori', fr: 'Accessoires', de: 'Accessoires' },
  // Clothing
  hoodies: { ru: 'Худи', en: 'Hoodies', it: 'Felpe', fr: 'Sweats', de: 'Hoodies' },
  tshirts: { ru: 'Футболки', en: 'T-Shirts', it: 'T-Shirt', fr: 'T-Shirts', de: 'T-Shirts' },
  jackets: { ru: 'Куртки', en: 'Jackets', it: 'Giacche', fr: 'Vestes', de: 'Jacken' },
  pants: { ru: 'Брюки', en: 'Pants', it: 'Pantaloni', fr: 'Pantalons', de: 'Hosen' },
  // Shoes
  sneakers: { ru: 'Кроссовки', en: 'Sneakers', it: 'Sneakers', fr: 'Baskets', de: 'Sneaker' },
  sneakers_low: { ru: 'Кеды', en: 'Low-Top', it: 'Basse', fr: 'Basses', de: 'Low-Top' },
  boots: { ru: 'Ботинки', en: 'Boots', it: 'Stivali', fr: 'Bottes', de: 'Stiefel' },
  loafers: { ru: 'Лоферы', en: 'Loafers', it: 'Mocassini', fr: 'Mocassins', de: 'Loafer' },
  sandals: { ru: 'Сандалии и слайды', en: 'Sandals & Slides', it: 'Sandali e slides', fr: 'Sandales et claquettes', de: 'Sandalen & Slides' },
  // Accessories. Caps are "Cappellini" in Italian now that "Cappelli" names hats.
  bags: { ru: 'Сумки', en: 'Bags', it: 'Borse', fr: 'Sacs', de: 'Taschen' },
  caps: { ru: 'Кепки', en: 'Caps', it: 'Cappellini', fr: 'Casquettes', de: 'Kappen' },
  hats: { ru: 'Шляпы', en: 'Hats', it: 'Cappelli', fr: 'Chapeaux', de: 'Hüte' },
  watches: { ru: 'Часы', en: 'Watches', it: 'Orologi', fr: 'Montres', de: 'Uhren' },
  sunglasses: { ru: 'Солнцезащитные очки', en: 'Sunglasses', it: 'Occhiali', fr: 'Lunettes de soleil', de: 'Sonnenbrillen' },
  gloves: { ru: 'Перчатки', en: 'Gloves', it: 'Guanti', fr: 'Gants', de: 'Handschuhe' },
}

export const STATUS_LABELS: Record<StatusKey, LocalizedText> = {
  in_stock: { ru: 'В наличии', en: 'In Stock', it: 'Disponibile', fr: 'En stock', de: 'Auf Lager' },
  out_of_stock: { ru: 'Нет в наличии', en: 'Out of Stock', it: 'Esaurito', fr: 'Rupture de stock', de: 'Nicht auf Lager' },
  limited_edition: { ru: 'Лимитированная серия', en: 'Limited Edition', it: 'Edizione Limitata', fr: 'Édition Limitée', de: 'Limitierte Auflage' },
  premium_quality: { ru: 'Премиум качество', en: 'Premium Quality', it: 'Qualità Premium', fr: 'Qualité Premium', de: 'Premium-Qualität' },
}

/**
 * AI Stylist option labels, keyed by the SYSTEM keys the engine filters on.
 *
 * The consultation used to carry these as English-only string maps inside the
 * component, so a Russian visitor answered "Everyday / Streetwear / Black" and
 * the result cards printed the raw keys back at them. The keys never change —
 * they are what goes over the wire and what the engine matches — only the
 * label shown for each one does.
 *
 * Typed as Record<Key, ...> on purpose: adding an occasion, style, colour or
 * fit to lib/stylist/types.ts without a label here in all five locales is now
 * a compile error, instead of a blank card in production.
 */

export const STYLIST_OCCASION_LABELS: Record<Occasion, LocalizedText> = {
  everyday: { ru: "На каждый день", en: "Everyday", it: "Tutti i giorni", fr: "Au quotidien", de: "Alltag" },
  date: { ru: "Свидание", en: "Date", it: "Appuntamento", fr: "Rendez-vous", de: "Date" },
  party: { ru: "Вечеринка", en: "Party", it: "Festa", fr: "Soirée", de: "Party" },
  study: { ru: "Учёба", en: "School / University", it: "Scuola / Università", fr: "École / Université", de: "Schule / Uni" },
  vacation: { ru: "Отпуск", en: "Vacation", it: "Vacanza", fr: "Vacances", de: "Urlaub" },
  work: { ru: "Работа", en: "Work", it: "Lavoro", fr: "Travail", de: "Arbeit" },
  special: { ru: "Особый повод", en: "Special event", it: "Occasione speciale", fr: "Événement spécial", de: "Besonderer Anlass" },
  browsing: { ru: "Просто смотрю", en: "Just looking", it: "Sto solo guardando", fr: "Je regarde juste", de: "Nur schauen" },
}

export const STYLIST_STYLE_LABELS: Record<StyleKey, LocalizedText> = {
  streetwear: { ru: "Стритвир", en: "Streetwear", it: "Streetwear", fr: "Streetwear", de: "Streetwear" },
  minimal: { ru: "Минимализм", en: "Minimal", it: "Minimal", fr: "Minimaliste", de: "Minimalistisch" },
  casual: { ru: "Кэжуал", en: "Casual", it: "Casual", fr: "Décontracté", de: "Casual" },
  old_money: { ru: "Олд мани", en: "Old money", it: "Old money", fr: "Old money", de: "Old Money" },
  luxury: { ru: "Люкс", en: "Luxury", it: "Lusso", fr: "Luxe", de: "Luxus" },
  y2k: { ru: "Y2K", en: "Y2K", it: "Y2K", fr: "Y2K", de: "Y2K" },
  oversized: { ru: "Оверсайз", en: "Oversized", it: "Oversize", fr: "Oversize", de: "Oversized" },
  smart_casual: { ru: "Смарт-кэжуал", en: "Smart casual", it: "Smart casual", fr: "Smart casual", de: "Smart Casual" },
  sporty: { ru: "Спортивный", en: "Sporty", it: "Sportivo", fr: "Sportswear", de: "Sportlich" },
  open: { ru: "Без предпочтений", en: "Let me decide", it: "Nessuna preferenza", fr: "Sans préférence", de: "Keine Präferenz" },
}

export const STYLIST_COLOR_LABELS: Record<ColorFamily, LocalizedText> = {
  black: { ru: "Чёрный", en: "Black", it: "Nero", fr: "Noir", de: "Schwarz" },
  white: { ru: "Белый", en: "White", it: "Bianco", fr: "Blanc", de: "Weiß" },
  grey: { ru: "Серый", en: "Grey", it: "Grigio", fr: "Gris", de: "Grau" },
  beige: { ru: "Бежевый", en: "Beige", it: "Beige", fr: "Beige", de: "Beige" },
  brown: { ru: "Коричневый", en: "Brown", it: "Marrone", fr: "Marron", de: "Braun" },
  navy: { ru: "Тёмно-синий", en: "Navy", it: "Blu navy", fr: "Bleu marine", de: "Dunkelblau" },
  green: { ru: "Зелёный", en: "Green", it: "Verde", fr: "Vert", de: "Grün" },
  red: { ru: "Красный", en: "Red", it: "Rosso", fr: "Rouge", de: "Rot" },
  blue: { ru: "Синий", en: "Blue", it: "Blu", fr: "Bleu", de: "Blau" },
  pastel: { ru: "Пастельные", en: "Pastel", it: "Pastello", fr: "Pastel", de: "Pastell" },
  bright: { ru: "Яркие", en: "Bright", it: "Accesi", fr: "Vifs", de: "Knallig" },
}

export const STYLIST_FIT_LABELS: Record<Fit, LocalizedText> = {
  oversized: { ru: "Оверсайз", en: "Oversized", it: "Oversize", fr: "Oversize", de: "Oversized" },
  regular: { ru: "Прямой крой", en: "Regular fit", it: "Vestibilità regolare", fr: "Coupe droite", de: "Regular Fit" },
  slim: { ru: "Приталенный", en: "Slim fit", it: "Slim", fr: "Coupe ajustée", de: "Slim Fit" },
}

/**
 * Fallback labels for a DEPARTMENT — the catalogue's top level.
 *
 * Only a fallback: `collections.name` carries the real, admin-editable
 * translations, and the store prefers those. These cover the moment before
 * the catalogue has loaded, and a department that reaches the storefront
 * without a name of its own.
 *
 * Women/Men/Kids are the departments from migration 0040. The three product
 * types below them stayed here as well, because a catalogue mid-migration has
 * both, and a label that disappears is worse than one that is redundant.
 */
export const GROUP_LABELS: Record<string, LocalizedText> = {
  women: { ru: 'Женщины', en: 'Women', it: 'Donna', fr: 'Femme', de: 'Damen' },
  men: { ru: 'Мужчины', en: 'Men', it: 'Uomo', fr: 'Homme', de: 'Herren' },
  kids: { ru: 'Дети', en: 'Kids', it: 'Bambini', fr: 'Enfants', de: 'Kinder' },
  clothing: { ru: 'Одежда', en: 'Clothing', it: 'Abbigliamento', fr: 'Vêtements', de: 'Kleidung' },
  shoes: { ru: 'Обувь', en: 'Shoes', it: 'Scarpe', fr: 'Chaussures', de: 'Schuhe' },
  accessories: { ru: 'Аксессуары', en: 'Accessories', it: 'Accessori', fr: 'Accessoires', de: 'Accessoires' },
}

// The UI copy itself lives in lib/ui-strings.ts — see the note there.

export type UIKey = keyof typeof UI

/** Stored OrderStatus value -> its display key. */
export const ORDER_STATUS_KEYS = {
  pending: 'orderStatus.pending',
  processing: 'orderStatus.processing',
  shipped: 'orderStatus.shipped',
  delivered: 'orderStatus.delivered',
  cancelled: 'orderStatus.cancelled',
  refunded: 'orderStatus.refunded',
} as const satisfies Record<string, UIKey>
