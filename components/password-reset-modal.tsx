'use client'

import { ArrowLeft, CheckCircle2, KeyRound, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

const MIN_PASSWORD_LENGTH = 8
/** Seconds the resend button stays disabled. Supabase itself rate-limits
 *  recovery emails to roughly one per minute, so anything shorter would just
 *  produce 429s the customer cannot act on. */
const RESEND_COOLDOWN_SECONDS = 60
const CODE_LENGTH = 6
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type Step = 'email' | 'code' | 'password' | 'done'

/**
 * OTP password recovery, start to finish, without leaving the page.
 *
 * Three steps in one modal: email -> emailed code -> new password. The
 * recovery session created by verifyOtp in step 2 is what authorises the
 * password update in step 3, so the steps must run in order and in the same
 * browser.
 *
 * Every visible string comes from the i18n dictionary; nothing is hardcoded,
 * so the flow follows the language selected in the header.
 */
export function PasswordResetModal({
  open,
  onClose,
  initialEmail = '',
}: {
  open: boolean
  onClose: () => void
  initialEmail?: string
}) {
  const { t, tf, requestRecoveryCode, verifyRecoveryCode, updatePassword, pushToast } =
    useStore()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // Reset to a clean first step whenever the modal is opened, so a previous
  // abandoned attempt never leaves a stale code or error on screen.
  useEffect(() => {
    if (!open) return
    setStep('email')
    setEmail(initialEmail)
    setCode('')
    setPassword('')
    setConfirm('')
    setError(null)
    setCooldown(0)
  }, [open, initialEmail])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  /** Maps a raw Supabase message onto a localized one. The provider's text is
   *  English-only, so surfacing it directly would break the language rule. */
  const localizeError = useCallback(
    (message?: string) => {
      if (!message) return t('otp.err.generic')
      if (/rate limit|too many|429|after \d+ seconds/i.test(message)) {
        return t('otp.err.rateLimit')
      }
      // Supabase reports a mail-delivery failure as a generic 500
      // "Error sending recovery email" — distinct from a bad code, and worth
      // its own message so the customer does not keep retrying a broken send.
      if (/sending|unexpected_failure|smtp/i.test(message)) return t('otp.err.sendFailed')
      if (/invalid|expired|token|otp/i.test(message)) return t('otp.err.codeInvalid')
      return t('otp.err.generic')
    },
    [t],
  )

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!EMAIL_RE.test(email.trim())) {
      setError(t('otp.err.email'))
      return
    }
    setBusy(true)
    setError(null)
    const { ok, message } = await requestRecoveryCode(email)
    setBusy(false)

    if (!ok) {
      setError(localizeError(message))
      return
    }
    // Advance regardless of whether the address exists. Confirming which
    // emails are registered would turn this into an enumeration oracle.
    setStep('code')
    setCooldown(RESEND_COOLDOWN_SECONDS)
  }

  async function handleResend() {
    if (busy || cooldown > 0) return
    setBusy(true)
    setError(null)
    const { ok, message } = await requestRecoveryCode(email)
    setBusy(false)

    if (ok) {
      setCooldown(RESEND_COOLDOWN_SECONDS)
      pushToast({ title: t('otp.step2.resent'), variant: 'success' })
      return
    }
    // Start the cooldown even on a 429 — the button should stop inviting a
    // retry that is guaranteed to fail for the next minute.
    if (message && /rate limit|too many|429/i.test(message)) {
      setCooldown(RESEND_COOLDOWN_SECONDS)
    }
    setError(localizeError(message))
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!code.trim()) {
      setError(t('otp.err.codeRequired'))
      return
    }
    setBusy(true)
    setError(null)
    const { ok, message } = await verifyRecoveryCode(email, code)
    setBusy(false)

    if (!ok) {
      setError(localizeError(message))
      return
    }
    setStep('password')
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(tf('otp.err.tooShort', { n: MIN_PASSWORD_LENGTH }))
      return
    }
    if (password !== confirm) {
      setError(t('otp.err.mismatch'))
      return
    }
    setBusy(true)
    setError(null)
    const { ok, message } = await updatePassword(password)
    setBusy(false)

    if (!ok) {
      setError(localizeError(message))
      return
    }
    setStep('done')
  }

  if (!open) return null

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm.length > 0 && confirm !== password

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="otp-title"
        className="animate-fade-up fixed left-1/2 top-1/2 z-[101] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 border border-border bg-popover p-6 shadow-2xl sm:p-8"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {step === 'done' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" strokeWidth={1.5} />
            ) : (
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.5} />
            )}
            <div>
              <h2
                id="otp-title"
                className="font-serif text-lg font-bold tracking-tight text-foreground"
              >
                {step === 'email' && t('otp.step1.title')}
                {step === 'code' && t('otp.step2.title')}
                {step === 'password' && t('otp.step3.title')}
                {step === 'done' && t('otp.done.title')}
              </h2>
              <p className="mt-1 text-[12px] font-light leading-relaxed text-muted-foreground">
                {step === 'email' && t('otp.step1.body')}
                {step === 'code' && tf('otp.step2.body', { email })}
                {step === 'password' && tf('otp.step3.body', { n: MIN_PASSWORD_LENGTH })}
                {step === 'done' && t('otp.done.body')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-muted-foreground transition hover:text-foreground"
            aria-label={t('otp.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1 — email */}
        {step === 'email' && (
          <form onSubmit={handleRequestCode} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="otp-email"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground"
              >
                {t('otp.step1.emailLabel')}
              </label>
              <input
                id="otp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-gold"
              />
            </div>

            {error && <p className="text-[12px] text-destructive">{error}</p>}

            <SubmitButton busy={busy} disabled={!email.trim()}>
              {t('otp.step1.submit')}
            </SubmitButton>
          </form>
        )}

        {/* Step 2 — code */}
        {step === 'code' && (
          <form onSubmit={handleVerifyCode} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="otp-code"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground"
              >
                {t('otp.step2.codeLabel')}
              </label>
              <input
                id="otp-code"
                type="text"
                value={code}
                // Strip everything but digits as they type: pasting a code out
                // of an email client often brings whitespace with it.
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={'0'.repeat(CODE_LENGTH)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-foreground outline-none transition focus:border-gold"
              />
            </div>

            {error && <p className="text-[12px] text-destructive">{error}</p>}

            <SubmitButton busy={busy} disabled={!code.trim()}>
              {t('otp.step2.submit')}
            </SubmitButton>

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              {cooldown > 0 ? (
                <p className="text-center text-[11px] font-light text-muted-foreground">
                  {tf('otp.step2.resendIn', { n: cooldown })}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleResend()}
                  disabled={busy}
                  className="text-center text-[11px] font-medium text-gold underline-offset-4 transition hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('otp.step2.resend')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setStep('email')
                  setCode('')
                  setError(null)
                }}
                className="flex items-center justify-center gap-1.5 text-[11px] font-light text-muted-foreground transition hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                {t('otp.step2.changeEmail')}
              </button>
            </div>
          </form>
        )}

        {/* Step 3 — new password */}
        {step === 'password' && (
          <form onSubmit={handleUpdatePassword} noValidate className="space-y-4">
            <PasswordInput
              label={t('otp.step3.new')}
              value={password}
              onChange={setPassword}
              required
              autoFocus
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              error={tooShort}
              showLabel={t('otp.showPassword')}
              hideLabel={t('otp.hidePassword')}
            />

            <PasswordInput
              label={t('otp.step3.confirm')}
              value={confirm}
              onChange={setConfirm}
              required
              autoComplete="new-password"
              error={mismatch}
              showLabel={t('otp.showPassword')}
              hideLabel={t('otp.hidePassword')}
            />

            {tooShort && !error && (
              <p className="text-[12px] text-destructive">
                {tf('otp.err.tooShort', { n: MIN_PASSWORD_LENGTH })}
              </p>
            )}
            {mismatch && !tooShort && !error && (
              <p className="text-[12px] text-destructive">{t('otp.err.mismatch')}</p>
            )}
            {error && <p className="text-[12px] text-destructive">{error}</p>}

            <SubmitButton
              busy={busy}
              disabled={!password || !confirm || tooShort || mismatch}
            >
              {t('otp.step3.submit')}
            </SubmitButton>
          </form>
        )}

        {/* Done */}
        {step === 'done' && (
          <button
            type="button"
            onClick={onClose}
            className="w-full border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('otp.done.cta')}
          </button>
        )}
      </div>
    </>
  )
}

function SubmitButton({
  busy,
  disabled,
  children,
}: {
  busy: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className={cn(
        'flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300',
        'hover:bg-gold hover:text-gold-foreground',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40',
      )}
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  )
}
