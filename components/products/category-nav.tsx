'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Left-hand catalogue navigation for the category routes.
 *
 * Reads the tree from the store rather than taking it as a prop, for one
 * reason: the labels are localised and the locale lives on the client. The
 * server page has already validated the slugs and rendered the <h1> and the
 * BreadcrumbList — this is the same tree in the visitor's own language.
 *
 * Every entry is a real <Link>. That is the whole point of the refactor: the
 * catalogue used to be chips that mutated store state on a single page, so a
 * category could not be linked to, opened in a new tab, or shared.
 *
 * Below `lg` the column would eat the fold, so the same links render as a
 * horizontally scrollable rail above the grid. Same data, same order, same
 * active state — one component, so the two cannot drift.
 */
export function CategoryNav({
  group,
  category,
}: {
  group: string
  /** Undefined on a collection page; a category slug on a subcategory page. */
  category?: string
}) {
  const { products, categoryTree, groupLabels, categoryLabels, localize, t } = useStore()

  const tree = useMemo(
    () =>
      categoryTree
        .map((n) => ({
          slug: n.group,
          label: localize(groupLabels[n.group] ?? {}),
          count: products.filter((p) => p.group === n.group).length,
          items: n.items
            .map((c) => ({
              slug: c,
              label: localize(categoryLabels[c] ?? {}),
              count: products.filter((p) => p.group === n.group && p.category === c).length,
            }))
            // A subcategory with nothing in it is a dead link, not a filter
            // that returns nothing — the same rule the chips already applied.
            .filter((c) => c.count > 0),
        }))
        .filter((n) => n.count > 0),
    [products, categoryTree, groupLabels, categoryLabels, localize],
  )

  const active = tree.find((n) => n.slug === group)

  return (
    <>
      {/* Desktop: a real sidebar column. */}
      <nav
        aria-label={t('nav.collections')}
        className="hidden lg:block lg:w-[220px] lg:shrink-0"
      >
        <ul className="sticky top-24 space-y-6">
          {tree.map((node) => {
            const isActive = node.slug === group
            return (
              <li key={node.slug}>
                <Link
                  href={`/category/${node.slug}`}
                  aria-current={isActive && !category ? 'page' : undefined}
                  className={cn(
                    'flex items-baseline justify-between gap-2 text-[12px] uppercase tracking-[0.15em] transition-colors duration-200',
                    isActive
                      ? 'text-gold'
                      : 'text-muted-foreground/70 hover:text-foreground',
                  )}
                >
                  <span>{node.label}</span>
                  <span className="text-[11px] text-muted-foreground/40">{node.count}</span>
                </Link>

                {/* Only the collection you are in expands. An always-open tree
                    of every subcategory is a wall of links that hides where
                    you actually are. */}
                {isActive && node.items.length > 0 && (
                  <ul className="mt-3 space-y-2 border-l border-border/50 pl-4">
                    <li>
                      <Link
                        href={`/category/${node.slug}`}
                        aria-current={!category ? 'page' : undefined}
                        className={cn(
                          'flex items-baseline justify-between gap-2 text-[12px] font-light transition-colors duration-200',
                          !category
                            ? 'text-foreground'
                            : 'text-muted-foreground/60 hover:text-foreground',
                        )}
                      >
                        <span>{t('filter.all')}</span>
                        <span className="text-[11px] text-muted-foreground/40">{node.count}</span>
                      </Link>
                    </li>
                    {node.items.map((item) => {
                      const on = item.slug === category
                      return (
                        <li key={item.slug}>
                          <Link
                            href={`/category/${node.slug}/${item.slug}`}
                            aria-current={on ? 'page' : undefined}
                            className={cn(
                              'flex items-baseline justify-between gap-2 text-[12px] font-light transition-colors duration-200',
                              on
                                ? 'text-foreground'
                                : 'text-muted-foreground/60 hover:text-foreground',
                            )}
                          >
                            <span className={cn(on && 'border-b border-gold pb-0.5')}>
                              {item.label}
                            </span>
                            <span className="text-[11px] text-muted-foreground/40">
                              {item.count}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Mobile / tablet: the current collection's subcategories as a rail.
          `-mx-4 px-4` lets it bleed to the screen edge so the last chip is
          visibly cut off — the cue that the row scrolls. */}
      {active && active.items.length > 0 && (
        <nav
          aria-label={t('filter.categoryLabel')}
          className="-mx-4 mb-8 overflow-x-auto px-4 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex w-max items-center gap-x-5">
            <li>
              <Link
                href={`/category/${active.slug}`}
                aria-current={!category ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap text-[12px] uppercase tracking-[0.1em] transition-colors duration-200',
                  !category
                    ? 'border-b border-gold pb-1 text-foreground'
                    : 'pb-1 text-muted-foreground/60',
                )}
              >
                {t('filter.all')}
              </Link>
            </li>
            {active.items.map((item) => {
              const on = item.slug === category
              return (
                <li key={item.slug}>
                  <Link
                    href={`/category/${active.slug}/${item.slug}`}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'whitespace-nowrap text-[12px] uppercase tracking-[0.1em] transition-colors duration-200',
                      on
                        ? 'border-b border-gold pb-1 text-foreground'
                        : 'pb-1 text-muted-foreground/60',
                    )}
                  >
                    {item.label}{' '}
                    <span className="text-muted-foreground/40">· {item.count}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </>
  )
}
