'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Password field with a show/hide toggle.
 *
 * Notes on the details that matter here:
 *  - The toggle is a `type="button"`. Without that it defaults to `submit`
 *    inside a <form> and revealing the password would submit it.
 *  - Visibility resets per instance and is never persisted; a password left
 *    visible after a reload is a shoulder-surfing hazard.
 *  - `aria-pressed` + a real label make the state audible to screen readers,
 *    which otherwise hear only "button".
 *  - Right padding is reserved so a long password never runs under the icon.
 */
export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  required,
  minLength,
  placeholder,
  className,
  inputClassName,
  labelClassName,
  error,
  showLabel = 'Показать пароль',
  hideLabel = 'Скрыть пароль',
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  autoFocus?: boolean
  required?: boolean
  minLength?: number
  placeholder?: string
  className?: string
  /** Lets each call site keep its own field styling (the admin console and the
   *  storefront do not share a look). */
  inputClassName?: string
  labelClassName?: string
  error?: boolean
  /** Localized accessible labels for the toggle. Default to Russian because
   *  the admin console is Russian-only; the storefront passes translations. */
  showLabel?: string
  hideLabel?: string
}) {
  const [visible, setVisible] = useState(false)
  const id = useId()

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={id}
          className={cn(
            'mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground',
            labelClassName,
          )}
        >
          {label}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required={required}
          minLength={minLength}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-lg border bg-background px-3 py-2.5 pr-11 text-sm text-foreground outline-none transition focus:border-gold',
            error ? 'border-destructive' : 'border-border',
            inputClassName,
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Keeps focus in the field so the toggle never interrupts typing.
          tabIndex={-1}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" strokeWidth={1.5} />
          ) : (
            <Eye className="h-4 w-4" strokeWidth={1.5} />
          )}
        </button>
      </div>
    </div>
  )
}
