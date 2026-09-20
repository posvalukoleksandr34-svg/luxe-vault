'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { Reveal } from '@/components/reveal'
import { useStore } from '@/lib/store'
import type { UIKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * "Выберите раздел" — the storefront's top-level departments, directly under
 * the hero. Replaces the old <Collections /> grid (which listed the catalogue's
 * own collections) with the four marketplace departments.
 *
 * Every card points at the shop grid for now: the catalogue has no women /
 * men / kids / lifestyle sections yet. Once those exist as collections in the
 * admin console, change `href` to `/category/<slug>` and nothing else here
 * needs to move.
 *
 * Artwork lives in public/images (women.jpg, men.jpg, kids.jpg,
 * lifestyle.jpg). A file that is missing — or fails to load — leaves the card
 * on its own dark gradient rather than a broken frame, so the grid always
 * looks deliberate.
 *
 * Keeps id="collections": the header and footer both scroll to that anchor.
 */

type Section = {
  key: string
  labelKey: UIKey
  image: string
  href: string
  /** The gradient shown until the photograph loads, and if it never does. */
  fallback: string
}

const SECTIONS: Section[] = [
  {
    key: 'women',
    labelKey: 'sections.women',
    image: '/images/women.jpg',
    href: '/#shop',
    fallback: 'radial-gradient(120% 90% at 20% 0%, #232323 0%, #0c0c0c 70%)',
  },
  {
    key: 'men',
    labelKey: 'sections.men',
    image: '/images/men.jpg',
    href: '/#shop',
    fallback: 'radial-gradient(120% 90% at 80% 10%, #1e1e20 0%, #0a0a0a 70%)',
  },
  {
    key: 'kids',
    labelKey: 'sections.kids',
    image: '/images/kids.jpg',
    href: '/#shop',
    fallback: 'radial-gradient(120% 90% at 30% 100%, #262220 0%, #0b0a09 70%)',
  },
  {
    key: 'lifestyle',
    labelKey: 'sections.lifestyle',
    image: '/images/lifestyle.jpg',
    href: '/#shop',
    fallback: 'radial-gradient(120% 90% at 70% 90%, #1c1e1e 0%, #090a0a 70%)',
  },
]

export function SectionsGrid() {
  const { t } = useStore()
  // Which photographs are missing. Set from <Image onError>, which is also how
  // the product card handles a dead image URL.
  const [failed, setFailed] = useState<Record<string, boolean>>({})

  return (
    <section id="collections" className="scroll-mt-20 border-t border-border py-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <Reveal className="mb-10 text-center">
          <span aria-hidden className="mx-auto mb-5 block h-px w-12 bg-gold/60" />
          <h2 className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('sections.title')}
          </h2>
        </Reveal>

        {/* One column on a phone, two on a tablet, all four across on desktop. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {SECTIONS.map((section, i) => {
            const label = t(section.labelKey)
            return (
              <Reveal key={section.key} delay={i * 90}>
                <Link
                  href={section.href}
                  aria-label={label}
                  className={cn(
                    'card-gold product-card group relative block w-full overflow-hidden text-left',
                    // Tall editorial portrait on desktop; shorter on a phone so
                    // four stacked cards stay scrollable.
                    'aspect-[4/3] sm:aspect-[3/4]',
                  )}
                  style={{ background: section.fallback }}
                >
                  {!failed[section.key] && (
                    <Image
                      src={section.image}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      priority={i === 0}
                      onError={() => setFailed((prev) => ({ ...prev, [section.key]: true }))}
                      className="size-full object-cover opacity-80 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06] group-hover:opacity-100"
                    />
                  )}

                  {/* Keeps the label legible over any photograph. */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

                  <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                    <h3 className="font-sans text-lg font-bold uppercase leading-none tracking-[0.16em] text-white sm:text-xl">
                      {label}
                    </h3>
                    <span
                      aria-hidden
                      className="mt-3 block h-px w-8 bg-gold/70 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-16"
                    />
                  </div>

                  <span className="absolute left-0 top-0 h-px w-0 bg-gold transition-all duration-500 group-hover:w-full" />
                </Link>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
