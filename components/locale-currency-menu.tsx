'use client'

import { useEffect, useState } from 'react'
import { CURRENCY_CODES } from '@/lib/currency'
import { LOCALES } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Locale } from '@/lib/types'

/** Italian, English, German, French first, as the brief lists them — and
 *  Russian kept after them: it is the site's DEFAULT language, and removing
 *  it from the only language switch would strand everyone who lands in it. */
const LANGUAGE_ORDER: Locale[] = ['it', 'en', 'de', 'fr', 'ru']

const CURRENCY_NAME_KEY = {
  CHF: 'currency.CHF',
  EUR: 'currency.EUR',
  USD: 'currency.USD',
} as const

/**
 * Language and currency, in one place — `IT · CHF` in the header, a small
 * panel beneath it when opened.
 *
 * Built from the header's own vocabulary: the popover surface and border the
 * old language list used, small spaced capitals for the two headings, one
 * hairline between them, and a gold dot for the active choice. It stays open
 * after a selection, because there are two to make; outside click and Escape
 * close it.
 */
export function LocaleCurrencyMenu() {
  const { locale, setLocale, currency, setCurrency, t } = useStore()
  const [open, setOpen] = useState(false)
  const current = LOCALES.find((l) => l.code === locale)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('header.langCurrency')}
        className="flex items-center gap-1 whitespace-nowrap px-1.5 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground transition hover:text-foreground sm:px-2"
      >
        <span>{current?.flag ?? locale.toUpperCase()}</span>
        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>
        <span>{currency}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-label={t('header.langCurrency')}
            // max-w keeps it inside a 375px screen whatever the button's
            // position; anchored right, it opens leftwards under the header.
            className="animate-scale-in absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] border border-border bg-popover py-3 shadow-2xl"
          >
            <p className="px-4 pb-1.5 text-[10px] uppercase tracking-[0.3em] text-gold/70">
              {t('header.language')}
            </p>
            {LANGUAGE_ORDER.map((code) => {
              const l = LOCALES.find((x) => x.code === code)
              if (!l) return null
              return (
                <Option key={code} active={code === locale} onClick={() => setLocale(code)}>
                  {l.label}
                </Option>
              )
            })}

            <div className="mx-4 my-2.5 h-px bg-border/60" />

            <p className="px-4 pb-1.5 text-[10px] uppercase tracking-[0.3em] text-gold/70">
              {t('header.currency')}
            </p>
            {CURRENCY_CODES.map((code) => (
              <Option key={code} active={code === currency} onClick={() => setCurrency(code)}>
                <span className="tabular-nums">{code}</span>
                <span className="text-muted-foreground"> — {t(CURRENCY_NAME_KEY[code])}</span>
              </Option>
            ))}

            {/* Said here, where the choice is made, not only at checkout:
                what the currency means for each way of paying. */}
            <p className="px-4 pt-2.5 text-[10px] font-light leading-relaxed text-muted-foreground/60">
              {t('header.currencyNote')}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Option({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] transition-colors duration-200 hover:bg-accent/60',
        active ? 'text-gold' : 'text-foreground/85 hover:text-foreground',
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-gold' : 'bg-transparent')}
      />
    </button>
  )
}
