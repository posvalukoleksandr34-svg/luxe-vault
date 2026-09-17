// Ready-made button links and labels for the newsletter composer.
//
// Every path here is a real address: /catalog, /new-arrivals, /sale and
// /about are redirects in next.config.js to where that content lives today
// (the shop grid with a view applied, the About section). An email cannot be
// changed once it is sent, so its links point at these stable names rather
// than at today's page structure.

export type CtaPreset = { path: string; label: string }

export const CTA_LINK_PRESETS: CtaPreset[] = [
  { path: '/catalog', label: 'Каталог' },
  { path: '/new-arrivals', label: 'Новинки' },
  { path: '/sale', label: 'Распродажа' },
  { path: '/about', label: 'О нас' },
  { path: '/account', label: 'Личный кабинет' },
]

export const CTA_TEXT_PRESETS = ['Смотреть коллекцию', 'Перейти к новинкам', 'Получить скидку']

export function isPresetPath(value: string): boolean {
  return CTA_LINK_PRESETS.some((p) => p.path === value)
}
