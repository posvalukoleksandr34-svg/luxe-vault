'use client'

import { Loader2, MapPin } from 'lucide-react'
import { useEffect, useRef, useState, useId } from 'react'
import type { AddressSuggestion } from '@/app/api/geo/address/route'
import { cn } from '@/lib/utils'

/**
 * Street field with live address suggestions.
 *
 * Deliberately NOT a controlled-combobox library. The requirements are narrow:
 * type freely, optionally pick a suggestion, and have the postcode/city fields
 * fill themselves in when you do. Anything the customer types by hand must
 * still be accepted verbatim — a geocoder that has never heard of someone's
 * street must not block their order.
 */
export function AddressAutocomplete({
  label,
  value,
  onChange,
  onPick,
  country,
  required,
  error,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** Fired only when a suggestion is chosen, so postcode/city can be filled. */
  onPick: (suggestion: AddressSuggestion) => void
  /** ISO-3166 alpha-2 of the shipping country, used to scope results. */
  country?: string
  required?: boolean
  error?: string
  placeholder?: string
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  // Stable across renders and unique per instance, so two address fields on
  // one page cannot both claim the same listbox. useId is SSR-safe; a
  // hand-rolled random id would differ between server and client and trip
  // hydration.
  const listboxId = useId()

  // Set when the value change came from picking a suggestion, so the effect
  // below does not immediately re-query for the text it just wrote.
  const skipNextQuery = useRef(false)

  useEffect(() => {
    if (skipNextQuery.current) {
      skipNextQuery.current = false
      return
    }
    if (value.trim().length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }

    // 250ms is the window where the request feels instant but a fast typist
    // still produces one call instead of one per character.
    const timer = setTimeout(async () => {
      const controller = new AbortController()
      setLoading(true)
      try {
        const params = new URLSearchParams({ q: value.trim() })
        if (country) params.set('country', country)
        const res = await fetch(`/api/geo/address?${params}`, { signal: controller.signal })
        const data = await res.json()
        const next: AddressSuggestion[] = Array.isArray(data.suggestions) ? data.suggestions : []
        setSuggestions(next)
        setOpen(next.length > 0)
        setHighlighted(-1)
      } catch {
        // Aborted or offline — leave whatever is on screen rather than
        // flashing the list away mid-type.
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [value, country])

  // Close on outside click, so the list never sits over the rest of the form.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function choose(suggestion: AddressSuggestion) {
    skipNextQuery.current = true
    onChange(suggestion.street || suggestion.label)
    onPick(suggestion)
    setOpen(false)
    setSuggestions([])
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((i) => (i + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (event.key === 'Enter' && highlighted >= 0) {
      // Only swallow Enter when a suggestion is actually highlighted —
      // otherwise it must still submit the checkout form.
      event.preventDefault()
      choose(suggestions[highlighted])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative block">
      <span className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-foreground">
        {label}
        {required && <span className="text-gold/70">*</span>}
      </span>

      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          required={required}
          placeholder={placeholder}
          // The browser's own address dropdown would cover ours.
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          // Required alongside role="combobox": without it assistive
          // technology is told a listbox exists but not which element it is,
          // so the suggestions are announced as unrelated content.
          aria-controls={listboxId}
          aria-autocomplete="list"
          className={cn(
            'w-full border bg-background px-3 py-3 pr-9 text-[13px] font-light text-foreground outline-none transition',
            error ? 'border-destructive' : 'border-border focus:border-gold/40',
          )}
        />
        {loading && (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-gold/60" />
        )}
      </div>

      {error && <span className="mt-1.5 block text-[11px] text-destructive">{error}</span>}

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto border border-border bg-popover shadow-2xl"
        >
          {suggestions.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlighted}
                // onMouseDown, not onClick: the input's blur would otherwise
                // close the list before the click ever lands.
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(s)
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={cn(
                  'no-juice flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-[12px] font-light transition',
                  i === highlighted ? 'bg-accent text-foreground' : 'text-muted-foreground',
                )}
              >
                <MapPin className="mt-0.5 size-3 shrink-0 text-gold/60" />
                <span className="flex-1">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
