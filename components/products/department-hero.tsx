'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { DEPARTMENT_ART } from '@/lib/department-art'
import { useStore } from '@/lib/store'
import { useListing } from './listing-context'

/**
 * The header of a department page (Women, Men, Kids): the department's name
 * set large, what it holds, its own short text, and a photograph.
 *
 * One component for all three — the department is a prop, everything else is
 * read from the catalogue:
 *
 *  - the NAME is the department's own label (admin → Разделы);
 *  - the LINE ABOVE it counts what is really in the department — products
 *    and categories on sale now — rather than a slogan;
 *  - the TEXT is the description the owner wrote in the admin (0064), and
 *    nothing when there is none: no stand-in copy;
 *  - the PHOTOGRAPH is the cover the admin chose for the department, else the
 *    same default artwork as the homepage's department card
 *    (lib/department-art.ts), else a plain sand panel. Each is tried in turn,
 *    so a dead cover URL never shows a broken frame.
 *
 * Compact on a phone: a short photographic band above the title, so the first
 * products are still near the top of the screen. From `md` the text and the
 * photograph sit side by side.
 */
export function DepartmentHero({ group }: { group: string }) {
  const { t, tf, localize, groupLabels, collections, categoryImages, navTree } = useStore()
  const listing = useListing()

  const label = localize(groupLabels[group] ?? {}) || group
  const own = collections.find((c) => c.slug === group)
  const description = own?.description ? localize(own.description) : ''

  const productCount = useMemo(
    () => (listing?.products ?? []).filter((p) => p.group === group).length,
    [listing, group],
  )
  // navTree lists only the categories with something on sale.
  const categoryCount = navTree.find((n) => n.group === group)?.items.length ?? 0

  const art = DEPARTMENT_ART[group]
  const sources = useMemo(
    () =>
      Array.from(
        new Set([categoryImages[group], own?.image, art?.image].filter((x): x is string => Boolean(x))),
      ),
    [categoryImages, group, own?.image, art?.image],
  )
  const [failed, setFailed] = useState(0)
  const photo = sources[failed]

  const facts = [
    productCount > 0
      ? productCount === 1
        ? t('category.itemCountOne')
        : tf('category.itemCount', { n: productCount })
      : '',
    categoryCount > 0
      ? categoryCount === 1
        ? t('dept.categoryCountOne')
        : tf('dept.categoryCount', { n: categoryCount })
      : '',
  ].filter(Boolean)

  return (
    <section
      aria-labelledby="department-title"
      className="mb-8 grid overflow-hidden border border-border/60 bg-secondary/50 md:mb-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:mb-12"
    >
      <div className="order-2 flex flex-col justify-center gap-3 px-5 py-6 sm:px-8 sm:py-8 md:order-1 md:gap-4 lg:px-12 lg:py-12">
        {facts.length > 0 && (
          <p className="text-[10px] uppercase tracking-[0.28em] text-gold sm:text-[11px]">
            {facts.join(' · ')}
          </p>
        )}
        <h1
          id="department-title"
          className="font-serif text-[40px] font-bold uppercase leading-[0.95] tracking-[0.03em] text-foreground sm:text-6xl lg:text-7xl"
        >
          {label}
        </h1>
        {description && (
          <p className="max-w-md text-[14px] font-light leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      {/* Decorative: the department's name is the heading beside it. */}
      <div
        aria-hidden
        className="relative order-1 h-[156px] overflow-hidden sm:h-[220px] md:order-2 md:h-auto md:min-h-[320px] lg:min-h-[380px]"
        style={{ background: art?.fallback ?? 'radial-gradient(120% 90% at 50% 0%, #f2ebdf 0%, #e2d6c2 75%)' }}
      >
        {photo && (
          <Image
            key={photo}
            src={photo}
            alt=""
            fill
            priority
            sizes="(max-width: 767px) 100vw, 56vw"
            onError={() => setFailed((n) => n + 1)}
            className="object-cover object-[50%_30%]"
          />
        )}
      </div>
    </section>
  )
}
