'use client'

import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { useStore } from '@/lib/store'
import { createClient } from '@/lib/supabase/client'

/**
 * The account look for a password field.
 *
 * Mobile metrics are written out here rather than inherited, because this
 * string is merged over PasswordInput's own classes with tailwind-merge, and
 * the LATER size wins: the previous `text-[13px]` silently replaced the
 * input's `text-base`, leaving a 13px field on a phone — the size at which iOS
 * Safari zooms the page on focus. `pr-11` for the same reason: `pr-10` beat
 * the base `pr-11` and let a long password run 4px under the 44px eye button.
 */
const FIELD =
  'h-11 w-full border border-border bg-background px-3.5 py-2.5 pr-11 text-base leading-normal text-foreground outline-none transition focus:border-gold md:h-10 md:px-3 md:text-[13px]'

/**
 * Change password.
 *
 * Shared by the account drawer and the /account route.
 *
 * NO CURRENT-PASSWORD FIELD, deliberately. Supabase's `updateUser({ password })`
 * authenticates with the active session and offers no way to verify the old
 * password, so a field asking for it could only ever be theatre — collected,
 * unchecked, and giving a false impression that it protects something. The
 * real protection is that the session must be valid; anyone who has that can
 * already act as the customer.
 *
 * Both fields are required to match. Supabase accepts a single value happily,
 * and a typo in a password nobody can read back is a lockout.
 */
export function PasswordForm({ compact = false }: { compact?: boolean }) {
  const { t, pushToast } = useStore()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change() {
    if (saving) return

    if (password.length < 8) {
      setError(t('account.passwordTooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('account.passwordMismatch'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const { error: authError } = await createClient().auth.updateUser({ password })
      if (authError) {
        setError(authError.message)
        return
      }
      setPassword('')
      setConfirm('')
      pushToast({ title: t('account.passwordChanged'), variant: 'success' })
    } finally {
      setSaving(false)
    }
  }

  return (
    // `compact` is the account drawer, a fixed panel: that is what .panel-gold
    // exists for — the same glass without the card's lift, which would move
    // the field under the customer's finger as it takes focus.
    <section className={compact ? 'panel-gold p-4' : 'card-gold p-5'}>
      <h3
        className={
          compact
            ? 'mb-3 font-serif text-base font-medium text-foreground'
            : 'mb-4 font-serif text-lg font-medium text-foreground'
        }
      >
        {t('account.changePassword')}
      </h3>

      <div className={compact ? 'space-y-3' : 'max-w-md space-y-3'}>
        {/* The project's own input, so the show/hide toggle behaves the same
            here as it does at sign-up and password reset. It renders its own
            <label>, so wrapping it in another one would nest two. */}
        <PasswordInput
          label={t('account.newPassword')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          labelClassName="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
          inputClassName={FIELD}
          showLabel={t('auth.showPassword')}
          hideLabel={t('auth.hidePassword')}
        />

        <PasswordInput
          label={t('account.confirmPassword')}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={confirm.length > 0 && confirm !== password}
          labelClassName="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
          inputClassName={FIELD}
          showLabel={t('auth.showPassword')}
          hideLabel={t('auth.hidePassword')}
        />

        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={change}
          disabled={saving || password.length === 0}
          className="flex w-full items-center justify-center gap-2 border border-gold/40 bg-gold/5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {t('account.changePassword')}
        </button>
      </div>
    </section>
  )
}
