'use client'

import { Link } from '@/components/locale-link'
import { filterToParams } from '@/lib/filter-url'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useListing } from './listing-context'

/**
 * The top of a department page (Women, Men, Kids) and of its subcategory
 * pages: the department's name, a line of real counts, the owner's short
 * text when there is one, and the department's subcategories as one row of
 * links — "All" first.
 *
 * Deliberately compact: no photograph or banner, so the products start near
 * the top of the screen. The other departments are not repeated here — the
 * visitor has already chosen one, and the store's own menu still leads to
 * the rest.
 *
 * THE ROW IS NAVIGATION, NOT A FILTER CONTROL. "All" is the department's own
 * page (/category/women), every other entry its subcategory page
 * (/category/women/jackets) — real addresses, so each can be shared, indexed
 * and opened in a new tab. The refinements in force (size, colour, price,
 * availability, sale, sort) ride along in the query string, so switching
 * between subcategories keeps them.
 *
 * Only categories with something on sale are listed (the store's navTree),
 * in the admin's order, each with the number of products in it.
 */
export function DepartmentHeader({ group, category }: { group: string; category?: string }) {
  const { t, tf, localize, groupLabels, categoryLabel, collections, navTree, filter } = useStore()
  const listing = useListing()

  const label = localize(groupLabels[group] ?? {}) || group
  const own = collections.find((c) => c.slug === group)
  const description = own?.description ? localize(own.description) : ''
  const counts = listing?.counts ?? {}

  const slugs = navTree.find((n) => n.group === group)?.items ?? []
  const departmentCount = counts[group] ?? 0
  const query = filterToParams(filter).toString()
  const href = (path: string) => (query ? `${path}?${query}` : path)

  const items = [
    { key: '', label: t('filter.all'), count: departmentCount, path: `/category/${group}` },
    ...slugs.map((slug) => ({
      key: slug,
      label: localize(categoryLabel(group, slug)) || slug,
      count: counts[`${group}/${slug}`] ?? 0,
      path: `/category/${group}/${slug}`,
    })),
  ]
  const activeLabel = category ? items.find((i) => i.key === category)?.label ?? '' : ''

  const facts = [
    departmentCount > 0
      ? departmentCount === 1
        ? t('category.itemCountOne')
        : tf('category.itemCount', { n: departmentCount })
      : '',
    slugs.length > 0
      ? slugs.length === 1
        ? t('dept.categoryCountOne')
        : tf('dept.categoryCount', { n: slugs.length })
      : '',
  ].filter(Boolean)

  return (
    <header className="mb-6 lg:mb-8">
      {facts.length > 0 && (
        <p className="mb-2 text-[10px] uppercase tracking-[0.28em] text-gold sm:text-[11px]">
          {facts.join(' · ')}
        </p>
      )}
      <h1 className="font-serif text-4xl font-bold uppercase leading-none tracking-[0.03em] text-foreground sm:text-5xl">
        {label}
        {/* The subcategory, for the outline and for a screen reader; on
            screen it is the selected entry of the row below. */}
        {activeLabel && <span className="sr-only">: {activeLabel}</span>}
      </h1>
      {description && (
        <p className="mt-3 max-w-2xl text-[14px] font-light leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}

      {/* "All" alone is not a choice: the row appears once the department
          has a subcategory with something in it. */}
      {slugs.length > 0 && (
        <nav aria-label={t('category.browse')} className="-mx-4 mt-6 sm:-mx-6 lg:mx-0">
          <ul
            className={cn(
              'flex gap-2 overflow-x-auto px-4 pb-1 sm:px-6 lg:flex-wrap lg:overflow-visible lg:px-0',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            )}
          >
            {items.map((item) => {
              const active = (category ?? '') === item.key
              return (
                <li key={item.key || 'all'} className="shrink-0">
                  <Link
                    href={href(item.path)}
                    scroll={false}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-9 items-center gap-2 border px-4 text-[12px] uppercase tracking-[0.12em] transition-colors',
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border/70 text-foreground hover:border-gold/60',
                    )}
                  >
                    {item.label}
                    <span
                      className={cn(
                        'text-[11px] tabular-nums tracking-normal',
                        active ? 'text-background/70' : 'text-muted-foreground',
                      )}
                    >
                      {item.count}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </header>
  )
}
