'use client'

import { getCountries, type CountryCode } from 'libphonenumber-js'
import { useMemo } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/** Native select on purpose: fully accessible, keyboard-friendly and
 * zero-JS, styled to match the boutique's sharp field treatment. */
export function CountrySelect({
  value,
  onChange,
  error,
  id,
}: {
  value: string
  onChange: (value: CountryCode) => void
  error?: boolean
  id?: string
}) {
  const { locale } = useStore()

  const countries = useMemo(() => {
    let displayNames: Intl.DisplayNames | null = null
    try {
      displayNames = new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      displayNames = null
    }
    return getCountries()
      .map((code) => ({ code, name: displayNames?.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [locale])

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as CountryCode)}
      className={cn(
        'w-full border bg-background px-3 py-3 text-[13px] font-light text-foreground outline-none transition',
        error ? 'border-destructive' : 'border-border focus:border-gold/40',
      )}
    >
      {countries.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
