'use client'

import { ArrowUpRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useMemo } from 'react'
import { Reveal } from '@/components/reveal'
import { DEFAULT_CATEGORY_IMAGES } from '@/lib/data'
import { useStore } from '@/lib/store'

export function Collections() {
  const { t, localize, products, categoryImages, categoryTree, groupLabels } = useStore()

  // Counts (and which cards even appear) are derived live from the actual
  // product catalog on every render — never a hardcoded number — so
  // deleting products immediately drops a group to its real count and
  // removes it here the moment it's empty, instead of leaving a ghost card.
  const collections = useMemo(
    () =>
      categoryTree.map(({ group }) => ({
        group,
        image: categoryImages[group] || DEFAULT_CATEGORY_IMAGES[group],
        count: products.filter((p) => p.group === group).length,
      })).filter((col) => col.count > 0),
    [products, categoryImages, categoryTree],
  )

  if (collections.length === 0) return null

  return (
    <section id="collections" className="scroll-mt-20 border-t border-border py-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <Reveal className="mb-10 text-center">
          <p className="mb-3 text-[11px] uppercase tracking-[0.4em] text-gold/70">
            {t('collections.subtitle')}
          </p>
          <h2 className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('collections.title')}
          </h2>
        </Reveal>

        <div className="grid gap-4 md:grid-cols-3">
          {collections.map((col, i) => (
            <Reveal key={col.group} delay={i * 120}>
              {/* Was a <button> that set a store filter and smooth-scrolled to
                  `#shop`. That made a collection unlinkable: no URL to share,
                  no new tab, nothing for a crawler to follow, and a back button
                  that left the shop scrolled and filtered. It is a real route
                  now, so it is a real link. */}
              <Link
                href={`/category/${col.group}`}
                className="card-gold group relative block aspect-[4/5] w-full overflow-hidden text-left"
              >
                {/* Collection covers are the largest images on the homepage and
                    the usual LCP element, so they are the ones that most need
                    the optimiser's resizing and AVIF/WebP re-encoding. `fill`
                    because the button already establishes the 4:5 box. */}
                <Image
                  src={col.image}
                  alt={localize(groupLabels[col.group] ?? {})}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
                  priority={i === 0}
                  className="size-full object-cover opacity-70 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06] group-hover:opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />

                <div className="absolute inset-x-0 bottom-0 p-6">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                    {col.count} {col.count === 1 ? 'товар' : 'товаров'}
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    <h3 className="font-serif text-2xl font-semibold text-foreground transition-colors duration-300 group-hover:text-gold">
                      {localize(groupLabels[col.group] ?? {})}
                    </h3>
                    <ArrowUpRight className="size-5 text-muted-foreground transition-all duration-300 group-hover:text-gold group-hover:translate-x-0.5" />
                  </div>
                </div>

                <span className="absolute left-0 top-0 h-px w-0 bg-gold transition-all duration-500 group-hover:w-full" />
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
