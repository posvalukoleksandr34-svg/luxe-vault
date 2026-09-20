import type { LocalizedText } from '@/lib/types'

/**
 * The storefront's main departments ("Разделы") — Женщины, Мужчины, Дети.
 *
 * A department IS a row in public.collections: the catalogue's top level was
 * the product type (Одежда / Обувь / Аксессуары) and is now the department,
 * with categories nesting under it (Женщины → Куртки). That needed no schema
 * change — `products.collection_id` already points at exactly this level, so
 * every product is assigned to a department by the same field, and the
 * existing /category/[collection] routes, filters and breadcrumbs work
 * unchanged.
 *
 * This file is the DEFINITION, not the data: the rows live in the database and
 * are created from the admin console (Разделы → "Создать раздел"). Anything
 * here that has no row yet simply has no page yet, and the homepage's
 * department cards fall back to the shop grid until it exists.
 *
 * A shop is free to add departments beyond these three; they are the ones the
 * admin offers as one-click presets and the ones the homepage grid shows.
 */
export type CoreDepartment = {
  slug: string
  name: LocalizedText
  /** Position among the collections, lowest first. */
  sortOrder: number
}

export const CORE_DEPARTMENTS: CoreDepartment[] = [
  {
    slug: 'women',
    name: { ru: 'Женщины', en: 'Women', it: 'Donna', fr: 'Femme', de: 'Damen' },
    sortOrder: 0,
  },
  {
    slug: 'men',
    name: { ru: 'Мужчины', en: 'Men', it: 'Uomo', fr: 'Homme', de: 'Herren' },
    sortOrder: 1,
  },
  {
    slug: 'kids',
    name: { ru: 'Дети', en: 'Kids', it: 'Bambini', fr: 'Enfants', de: 'Kinder' },
    sortOrder: 2,
  },
]

export const CORE_DEPARTMENT_SLUGS: string[] = CORE_DEPARTMENTS.map((d) => d.slug)

export function isCoreDepartment(slug: string): boolean {
  return CORE_DEPARTMENT_SLUGS.indexOf(slug) !== -1
}

/**
 * Orders slugs for a picker: the three departments first, in their own order,
 * then everything else alphabetically — so the admin's product form always
 * opens on a real department even in a catalogue that still holds older
 * collections.
 */
export function byDepartmentOrder(a: string, b: string): number {
  const ia = CORE_DEPARTMENT_SLUGS.indexOf(a)
  const ib = CORE_DEPARTMENT_SLUGS.indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  return a.localeCompare(b)
}
