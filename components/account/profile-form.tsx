'use client'

import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { loadSupabase } from '@/lib/supabase/lazy'

/**
 * Editable name and email.
 *
 * Shared by the account drawer and the /account route so there is one
 * implementation rather than two that drift — the drawer is the quick path
 * mid-browse, the route is the full page, and both should save identically.
 *
 * WHY THE METADATA KEY IS `name`, NOT `full_name`
 *
 * Two places hold a customer's name: the `profiles` row the app reads, and the
 * Supabase Auth user metadata that `handle_new_user` (migration 0001) copies
 * from on sign-up — and it reads `raw_user_meta_data ->> 'name'`. Writing
 * `full_name` would put a key in the metadata that nothing in this database
 * ever reads, so the name would appear to save and then not change.
 *
 * Both are written here, in that order, so the row the UI reads is updated
 * even if the metadata call fails.
 *
 * EMAIL IS NOT IMMEDIATE
 *
 * Supabase sends a confirmation link to the NEW address and keeps the old one
 * working until it is clicked. Without saying so, the customer sees "saved",
 * sees the old address still displayed, and reasonably concludes it failed.
 */
export function ProfileForm({ compact = false }: { compact?: boolean }) {
  const { currentUser, t, pushToast } = useStore()

  const [name, setName] = useState(currentUser?.name ?? '')
  const [email, setEmail] = useState(currentUser?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [emailPending, setEmailPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seeded when the session resolves or the profile changes elsewhere, so
  // the drawer does not show a stale name after an edit on the account page.
  useEffect(() => {
    setName(currentUser?.name ?? '')
    setEmail(currentUser?.email ?? '')
  }, [currentUser])


  // No date of birth: nothing in the shop used it, so it is no longer asked
  // for (migration 0050 removes the stored values).
  const dirty =
    name.trim() !== (currentUser?.name ?? '') ||
    email.trim() !== (currentUser?.email ?? '')

  async function save() {
    if (saving || !currentUser) return

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    if (trimmedName.length < 2) {
      setError(t('checkout.errName'))
      return
    }

    setSaving(true)
    setError(null)
    setEmailPending(false)

    try {
      if (trimmedName !== currentUser.name) {
        // Through a route, not the browser client. Writing `profiles` directly
        // from here matched zero rows under RLS and reported success, so the
        // customer saw "saved" for a change that never happened. Every other
        // table access in this app goes through a route for the same reason;
        // the browser client is used only for auth.*.
        const res = await fetch('/api/account/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmedName }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(
            data.error === 'INVALID_NAME' ? t('checkout.errName') : t('account.saveRefused'),
          )
        }
      }

      if (trimmedEmail && trimmedEmail !== currentUser.email) {
        const { error: authError } = await (await loadSupabase()).auth.updateUser({ email: trimmedEmail })
        if (authError) throw new Error(authError.message)
        setEmailPending(true)
      }

      pushToast({ title: t('account.saved'), variant: 'success' })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('checkout.orderFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    // `compact` is the account drawer, a fixed panel: .panel-gold is the glass
    // meant for that — no lift, so a field never moves as it takes focus.
    <section className={compact ? 'panel-gold p-4' : 'card-gold p-5'}>
      <h3
        className={
          compact
            ? 'mb-3 font-serif text-base font-medium text-foreground'
            : 'mb-4 font-serif text-lg font-medium text-foreground'
        }
      >
        {t('account.profile')}
      </h3>

      <div className={compact ? 'space-y-3' : 'max-w-md space-y-3'}>
        <Field
          label={t('user.name')}
          value={name}
          onChange={setName}
          type="text"
          autoComplete="name"
        />
        <Field
          label={t('user.email')}
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
        />

        {emailPending && (
          <p className="rounded-xl border border-gold/40 bg-gold/5 px-3 py-2.5 text-[12px] font-light text-gold">
            {t('account.emailPending')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          // Disabled while unchanged: a Save button that does nothing still
          // shows a success toast, which teaches people to distrust it.
          disabled={saving || !dirty}
          className="rounded-xl flex w-full items-center justify-center gap-2 border border-transparent bg-gold-gradient py-2.5 text-[11px] uppercase tracking-[0.12em] font-medium text-gold-foreground transition-all duration-300 hover:brightness-[1.05] disabled:cursor-not-allowed disabled:opacity-40 shadow-gold"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {t('account.save')}
        </button>
      </div>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  min,
  max,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type: string
  autoComplete: string
  min?: string
  max?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        min={min}
        max={max}
        // 44px / 16px below md — the iOS zoom threshold; the desktop field is
        // unchanged.
        className="h-11 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-base leading-normal text-foreground outline-none transition focus:border-gold md:h-10 md:px-3 md:text-[13px]"
      />
    </label>
  )
}
