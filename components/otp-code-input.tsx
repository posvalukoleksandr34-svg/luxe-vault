'use client'

import { OTP_CODE_LENGTH } from '@/lib/auth-config'
import { cn } from '@/lib/utils'

/**
 * Single-field entry for an emailed one-time code.
 *
 * Shared by registration and password recovery so the two can never drift on
 * length, filtering, or autofill behaviour.
 *
 * Non-digits are stripped on the way in: pasting a code out of a mail client
 * routinely brings a trailing space or a non-breaking space with it, and
 * `verifyOtp` rejects those outright.
 */
export function OtpCodeInput({
  id,
  label,
  value,
  onChange,
  autoFocus,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  error?: boolean
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH))}
        required
        autoFocus={autoFocus}
        // inputMode surfaces the numeric keypad on mobile; one-time-code lets
        // iOS and Android offer the code straight from the notification.
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_CODE_LENGTH}
        placeholder={'0'.repeat(OTP_CODE_LENGTH)}
        className={cn(
          'w-full rounded-lg border bg-background px-3 py-2.5 text-center font-mono text-lg tracking-[0.35em] text-foreground outline-none transition focus:border-gold',
          error ? 'border-destructive' : 'border-border',
        )}
      />
    </div>
  )
}

/** True once the field holds a full-length code. */
export function isOtpComplete(value: string): boolean {
  return value.trim().length === OTP_CODE_LENGTH
}
