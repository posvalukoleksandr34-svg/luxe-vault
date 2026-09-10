'use client'

import { useStore } from '@/lib/store'

/**
 * The page's heading and lead.
 *
 * A client component purely because the copy is localised and the translator
 * lives in the store. It still renders in the initial HTML — Next server-
 * renders client components — so a crawler and a cold visitor both get the
 * heading in the site's default locale, and someone who has switched language
 * gets theirs.
 */
export function StylistIntro() {
  const { t } = useStore()
  return (
    <header className="mb-12 max-w-2xl">
      <p className="mb-3 text-[11px] uppercase tracking-[0.4em] text-gold/70">Luxe Vault</p>
      <h1 className="font-serif text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
        {t('stylist.cta')}
      </h1>
      <p className="mt-4 text-[15px] font-light leading-relaxed text-muted-foreground">
        {t('stylist.lead')}
      </p>
    </header>
  )
}
