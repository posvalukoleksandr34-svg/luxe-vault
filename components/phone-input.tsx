'use client'

import { Check, ChevronDown, Search } from 'lucide-react'
import { AsYouType, getCountryCallingCode, type CountryCode } from 'libphonenumber-js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCountryOptions, searchCountries } from '@/lib/country-search'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export const DEFAULT_COUNTRY: CountryCode = 'CH'

function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
}

/**
 * Live per-country formatting as the customer types, so the field reads like
 * a real phone number instead of a digit soup.
 *
 * libphonenumber only applies national grouping when it sees the trunk
 * prefix (e.g. the Swiss "0"), so a number typed without it is formatted via
 * the international form and the dial code is then trimmed back off. Both
 * entry habits — "079 …" and "79 …" — end up neatly grouped.
 */
export function formatAsYouType(national: string, country: CountryCode): string {
  const digits = national.replace(/[^\d]/g, '')
  if (!digits) return ''

  if (digits.startsWith('0')) return new AsYouType(country).input(digits)

  const dial = getCountryCallingCode(country)
  const international = new AsYouType(country).input(`+${dial}${digits}`)
  const trimmed = international.replace(`+${dial}`, '').trim()
  return trimmed || digits
}

export function PhoneInput({
  country,
  onCountryChange,
  value,
  onChange,
  error,
  id,
}: {
  country: CountryCode
  onCountryChange: (country: CountryCode) => void
  value: string
  onChange: (value: string) => void
  error?: boolean
  id?: string
}) {
  const { locale, t } = useStore()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Names in the page's language, English and Russian, so "Укр", "Ukr" and
  // "380" all find Ukraine — see lib/country-search.ts.
  const countries = useMemo(() => buildCountryOptions(locale), [locale])
  const filtered = useMemo(() => searchCountries(countries, search), [countries, search])

  function choose(code: CountryCode) {
    onCountryChange(code)
    // Re-run the mask for the newly selected country.
    onChange(formatAsYouType(value, code))
    setOpen(false)
  }

  // Close on outside click so the dropdown never traps the checkout flow.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const active = countries.find((c) => c.code === country)

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          'flex border transition',
          error ? 'border-destructive' : 'border-border focus-within:border-gold/40',
        )}
      >
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v)
            setSearch('')
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-3 text-[13px] font-light text-foreground transition hover:bg-accent"
        >
          <span className="text-[15px] leading-none">{flagEmoji(country)}</span>
          <span className="font-mono text-[12px] text-muted-foreground">{active?.dial}</span>
          <ChevronDown className={cn('size-3 text-muted-foreground transition', open && 'rotate-180')} />
        </button>

        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={value}
          onChange={(e) => onChange(formatAsYouType(e.target.value, country))}
          className="w-full bg-background px-3 py-3 text-[13px] font-light text-foreground outline-none"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 border border-border bg-popover shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              aria-label={t('filter.search')}
              placeholder={t('filter.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // "Каз" then Enter picks the best match without reaching for
                // the mouse. Enter must not submit the checkout form.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (filtered[0]) choose(filtered[0].code)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                }
              }}
              className="w-full bg-transparent text-[12px] font-light text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => choose(c.code)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition hover:bg-accent',
                  c.code === country ? 'text-gold' : 'text-foreground',
                )}
              >
                <span className="text-[14px] leading-none">{flagEmoji(c.code)}</span>
                <span className="flex-1 truncate font-light">{c.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{c.dial}</span>
                {c.code === country && <Check className="size-3 shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-[12px] font-light text-muted-foreground">—</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
