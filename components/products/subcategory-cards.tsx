'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { Link } from '@/components/locale-link'
import { productImage } from '@/lib/product-image'
import { useStore } from '@/lib/store'
import { subcategoryCover } from '@/lib/subcategory-cover'
import { cn } from '@/lib/utils'
import { useListing } from './listing-context'

/**
 * Visual subcategory cards at the top of a department page (Donna → Giacche,
 * Borse, …): the name on the left, a photograph cropped on the right.
 *
 * What a department page opened on was the filter bar and, while the
 * department is still being stocked, an empty grid — nothing that says what
 * the department holds or where to go next. These are that answer, as real
 * links to /category/<department>/<subcategory>.
 *
 * Every department with subcategories shows them. The subcategories are the
 * department's own categories (admin → Разделы), in the admin's order. The
 * photograph is the cover the admin chose for the subcategory, else its best
 * product (lib/subcategory-cover.ts). A subcategory with neither still gets a
 * card, with an initial on the shop's sand ground and "Coming soon" instead of
 * a count: it is a real page that says so.
 *
 * LAYOUT. Phones and tablets: one row that scrolls sideways, bleeding to the
 * screen edge so the cut-off card says "there is more". From `lg`: a wrapped
 * grid across the full width above the sidebar and the grid.
 */

/** Whether a department page shows the cards: it has subcategories. */
export function useHasSubcategoryCards(group: string): boolean {
  const { categoryTree } = useStore()
  return (categoryTree.find((n) => n.group === group)?.items.length ?? 0) > 0
}

type Card = {
  slug: string
  label: string
  count: number
  image?: string
  /** A product shot (usually on white): multiplied onto the ivory. A cover
   *  the admin chose is shown as it is. */
  blend: boolean
}

export function SubcategoryCards({ group }: { group: string }) {
  const { categoryTree, categories, categoryLabels, localize, t, tf } = useStore()
  const listing = useListing()

  const cards = useMemo<Card[]>(() => {
    const node = categoryTree.find((n) => n.group === group)
    if (!node) return []
    const products = listing?.products ?? []
    return node.items.map((slug) => ({
      slug,
      label: localize(categoryLabels[slug] ?? {}) || slug,
      count:
        listing?.counts[`${group}/${slug}`] ??
        products.filter((p) => p.group === group && p.category === slug).length,
      ...(() => {
        const cover = subcategoryCover(categories, products, group, slug)
        return { image: cover.src, blend: cover.source === 'product' }
      })(),
    }))
  }, [categoryTree, categories, categoryLabels, localize, listing, group])

  if (cards.length === 0) return null

  return (
    <nav aria-label={t('category.browse')} className="-mx-4 mb-8 sm:-mx-6 lg:mx-0 lg:mb-10">
      <ul
        className={cn(
          'flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:px-6',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'lg:grid lg:snap-none lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0 xl:grid-cols-5',
        )}
      >
        {cards.map((card, i) => (
          <li key={card.slug} className="w-[208px] shrink-0 snap-start sm:w-[232px] lg:w-auto">
            <SubcategoryCard
              href={`/category/${group}/${card.slug}`}
              card={card}
              caption={
                card.count === 0
                  ? t('category.comingSoon')
                  : card.count === 1
                    ? t('category.itemCountOne')
                    : tf('category.itemCount', { n: card.count })
              }
              // The row sits above the fold: the first few photos are worth
              // fetching before the grid's.
              priority={i < 4}
            />
          </li>
        ))}
      </ul>
    </nav>
  )
}

function SubcategoryCard({
  href,
  card,
  caption,
  priority,
}: {
  href: string
  card: Card
  caption: string
  priority: boolean
}) {
  const [failed, setFailed] = useState(false)
  const photo = card.image && !failed ? productImage(card.image) : null

  return (
    <Link
      href={href}
      className={cn(
        'group relative flex h-[92px] items-center overflow-hidden rounded-2xl sm:h-[104px]',
        // Opaque ivory: the photograph is multiplied onto it (below), and over
        // a see-through ground the page's background would show in the blend.
        'border border-border/70 bg-secondary transition-[border-color,box-shadow] duration-300',
        'hover:border-gold/45 hover:shadow-[0_10px_30px_-18px_hsl(var(--foreground)/0.35)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <span className="relative z-10 flex min-w-0 basis-[56%] flex-col gap-1.5 pl-4 pr-2 sm:pl-5">
        <span className="line-clamp-2 font-serif text-[16px] font-semibold leading-tight tracking-tight text-foreground sm:text-[17px]">
          {card.label}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{caption}</span>
      </span>

      {/* The photograph, cropped into the right side. A product photo is
          multiplied onto the card's ivory, so a shot on white — what most
          product photos are — sits on the card's own ground instead of in a
          white box; an admin's cover is shown as it is. Decorative: the name
          is the link's text. */}
      <span aria-hidden className="absolute inset-y-0 right-0 isolate w-[46%] overflow-hidden bg-secondary">
        {photo ? (
          <Image
            src={photo}
            alt=""
            fill
            sizes="(min-width: 1280px) 130px, (min-width: 1024px) 150px, 110px"
            priority={priority}
            onError={() => setFailed(true)}
            className={cn(
              'object-cover object-[50%_35%] transition-transform duration-500 ease-out group-hover:scale-[1.05]',
              card.blend && 'mix-blend-multiply',
            )}
          />
        ) : (
          // Nothing to photograph yet: the initial, in the heading face, on
          // the shop's sand — intentional rather than a broken frame.
          <span
            className="flex h-full w-full items-center justify-center"
            style={{ background: 'radial-gradient(120% 100% at 70% 30%, #f3ece0 0%, #e2d6c2 80%)' }}
          >
            <span className="font-serif text-[44px] italic leading-none text-gold/70 sm:text-[52px]">
              {card.label.trim().charAt(0).toUpperCase()}
            </span>
          </span>
        )}
      </span>
    </Link>
  )
}
