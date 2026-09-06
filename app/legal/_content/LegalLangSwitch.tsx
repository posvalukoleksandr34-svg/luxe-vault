'use client'

import { LOCALES } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Language selector for the legal pages.
 *
 * These pages render outside the site header, so without this the localisation
 * is unreachable: a visitor who lands on /legal/terms from a footer link or a
 * shared URL has no control to change language and would be stuck with
 * whatever the store defaulted to.
 *
 * A flat row of codes rather than the header's dropdown — there are five, they
 * are two characters each, and a document page should not need a popover to
 * change one setting.
 */
export function LegalLangSwitch() {
  const { locale, setLocale } = useStore()

  return (
    <nav aria-label="Language" className="not-prose flex flex-wrap items-center gap-1">
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLocale(l.code)}
          aria-current={l.code === locale ? 'true' : undefined}
          className={cn(
            'border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition-all duration-300',
            l.code === locale
              ? 'border-gold/50 bg-gold/10 text-gold'
              : 'border-border/50 text-muted-foreground/60 hover:border-gold/30 hover:text-gold',
          )}
        >
          {l.flag}
        </button>
      ))}
    </nav>
  )
}
