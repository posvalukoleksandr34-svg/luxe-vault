'use client'

import Link from 'next/link'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { LookBlock } from '@/components/stylist/look-view'
import { useStore } from '@/lib/store'
import type { Look } from '@/lib/stylist/types'

/**
 * The body of a shared capsule page.
 *
 * Client-side only because every label is localised and the locale lives in
 * the store; the data itself was read on the server. The look renders through
 * the SAME LookBlock the stylist uses, so a shared capsule has the same cards,
 * the same per-piece add, "add entire outfit", and notify-when-available — one
 * implementation, not a second one that drifts.
 */
export function SharedCapsule({
  look,
  createdAt,
  missing,
}: {
  look: Look
  createdAt: string
  missing: number
}) {
  const { t, tf, locale } = useStore()

  let date = ''
  try {
    date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
      new Date(createdAt),
    )
  } catch {
    date = createdAt.slice(0, 10)
  }

  return (
    <>
      <Breadcrumbs
        trail={[
          { name: t('nav.shop'), url: '/#shop' },
          { name: t('stylist.title'), url: '/stylist' },
          { name: t('looks.capsule'), url: `/stylist/share/${look.id}` },
        ]}
      />

      <header className="mb-10 max-w-2xl">
        <p className="mb-3 text-[11px] uppercase tracking-[0.4em] text-gold/70">
          {tf('looks.savedOn', { date })}
        </p>
        <h1 className="font-serif text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
          {t('looks.capsule')}
        </h1>
        <p className="mt-4 text-[15px] font-light leading-relaxed text-muted-foreground">
          {t('looks.capsuleLead')}
        </p>
      </header>

      {missing > 0 && look.items.length > 0 && (
        <p className="mb-8 border-l-2 border-gold/40 bg-gold/[0.04] py-2.5 pl-4 text-[12px] font-light text-muted-foreground">
          {tf('looks.missingPieces', { n: missing })}
        </p>
      )}

      {look.items.length > 0 ? (
        <LookBlock look={look} missing={[]} heading={t('looks.capsule')} savedId={look.id} />
      ) : (
        <p className="py-16 text-center text-sm font-light text-muted-foreground">{t('looks.allGone')}</p>
      )}

      <div className="mt-14 border-t border-border/40 pt-8">
        <Link
          href="/stylist"
          className="inline-flex items-center gap-2 border border-gold/30 px-8 py-3.5 text-[11px] uppercase tracking-[0.2em] text-foreground transition-colors duration-300 hover:border-gold/60 hover:text-gold"
        >
          {t('looks.styleYourOwn')}
        </Link>
      </div>
    </>
  )
}
