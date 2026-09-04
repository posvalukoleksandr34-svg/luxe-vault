'use client'

import { Check, ChevronDown, Search } from 'lucide-react'
import { AsYouType, getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const { locale } = useStore()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const countries = useMemo(() => {
    let displayNames: Intl.DisplayNames | null = null
    try {
      displayNames = new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      displayNames = null
    }
    return getCountries()
      .map((code) => ({
        code,
        name: displayNames?.of(code) ?? code,
        dial: `+${getCountryCallingCode(code)}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [locale])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return countries
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dial.includes(q.replace(/^\+?/, '+')) ||
        c.dial.replace('+', '').startsWith(q.replace(/\D/g, '')),
    )
  }, [countries, search])

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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-[12px] font-light text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  onCountryChange(c.code)
                  // Re-run the mask for the newly selected country.
                  onChange(formatAsYouType(value, c.code))
                  setOpen(false)
                }}
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
