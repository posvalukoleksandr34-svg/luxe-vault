'use client'

import { CheckCircle2, KeyRound, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/client'

const MIN_PASSWORD_LENGTH = 8

/**
 * Catches a password-recovery return and puts the reset form in front of the
 * customer immediately, wherever on the site they landed.
 *
 * Why this exists alongside /auth/update-password:
 *
 * Supabase has two link flows. With PKCE (what @supabase/ssr uses) the email
 * link carries `?code=` to /auth/callback, which exchanges it server-side and
 * forwards to the dedicated page — that path does not fire PASSWORD_RECOVERY
 * in the browser at all. With the implicit/hash flow, or whenever the
 * project's Site URL points somewhere other than /auth/callback, the link
 * comes back as `#access_token=...&type=recovery` and the browser client
 * fires PASSWORD_RECOVERY instead.
 *
 * Without this listener that second case silently signs the visitor in and
 * drops them on the homepage with no way to set a password — the single most
 * common "the reset link does nothing" report. Handling both means the flow
 * works regardless of how the project's URLs are configured.
 */
export function PasswordRecoveryModal() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    const supabase = createClient()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // Synchronous on purpose: awaiting another supabase call inside this
      // callback can deadlock the client.
      if (event === 'PASSWORD_RECOVERY') setOpen(true)
    })

    // The event fires while the client parses the URL on load, which can land
    // before this listener attaches. Reading the hash directly covers that
    // race rather than relying on subscription timing.
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      setOpen(true)
    }

    return () => subscription.unsubscribe()
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setPassword('')
    setConfirm('')
    setError(null)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
      return
    }
    // Checked before submitting: a typo'd new password would otherwise lock
    // the customer out of the very account they are recovering.
    if (password !== confirm) {
      setError('Пароли не совпадают')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const { error } = await createClient().auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      // Clear the recovery hash so a refresh does not reopen the modal.
      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const mismatch = confirm.length > 0 && confirm !== password
  // Too short is caught on submit too, but disabling here keeps the button's
  // meaning consistent with the mismatch case: enabled means "this will work".
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH

  return (
    <>
      {/* No click-to-dismiss on the backdrop: the recovery session is
          single-use, so an accidental click outside would strand the customer
          with no way back in. Closing is an explicit choice. */}
      <div className="fixed inset-0 z-[110] bg-background/80 backdrop-blur-sm" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        className="animate-fade-up fixed left-1/2 top-1/2 z-[111] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 border border-border bg-popover p-6 shadow-2xl sm:p-8"
      >
        {done ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" strokeWidth={1.25} />
            <h2 id="recovery-title" className="font-serif text-xl font-bold text-foreground">
              Пароль обновлён
            </h2>
            <p className="text-sm font-light text-muted-foreground">
              Теперь вы можете пользоваться аккаунтом с новым паролем.
            </p>
            <button
              type="button"
              onClick={close}
              className="mt-2 border border-gold/30 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
            >
              Продолжить
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.5} />
                <div>
                  <h2
                    id="recovery-title"
                    className="font-serif text-lg font-bold tracking-tight text-foreground"
                  >
                    Новый пароль
                  </h2>
                  <p className="mt-1 text-[12px] font-light leading-relaxed text-muted-foreground">
                    Придумайте новый пароль — не короче {MIN_PASSWORD_LENGTH} символов.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                className="shrink-0 text-muted-foreground transition hover:text-foreground"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <PasswordInput
                label="Новый пароль"
                value={password}
                onChange={setPassword}
                required
                autoFocus
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                error={tooShort}
              />

              <PasswordInput
                label="Повторите пароль"
                value={confirm}
                onChange={setConfirm}
                required
                autoComplete="new-password"
                error={mismatch}
              />

              {tooShort && !error && (
                <p className="text-[12px] text-destructive">
                  Минимум {MIN_PASSWORD_LENGTH} символов
                </p>
              )}
              {mismatch && !tooShort && !error && (
                <p className="text-[12px] text-destructive">Пароли не совпадают</p>
              )}
              {error && <p className="text-[12px] text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={busy || !password || !confirm || mismatch || tooShort}
                className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Сохранить пароль
              </button>
            </form>
          </>
        )}
      </div>
    </>
  )
}
