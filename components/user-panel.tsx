'use client'

import {
  Loader2,
  LogOut,
  MailCheck,
  Package,
  User as UserIcon,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AccountOrders, isUnpaid } from '@/components/account-orders'
import { isOtpComplete, OtpCodeInput } from '@/components/otp-code-input'
import { PasswordInput } from '@/components/password-input'
import { PasswordResetModal } from '@/components/password-reset-modal'
import { fetchMyOrders } from '@/lib/order-registry'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Order } from '@/lib/types'

type Tab = 'orders' | 'profile'

export function UserPanel() {
  const {
    panel,
    setPanel,
    currentUser,
    login,
    register,
    resendConfirmation,
    verifySignupCode,
    signInWithGoogle,
    logout,
    t,
    tf,
    pushToast,
  } = useStore()

  const [tab, setTab] = useState<Tab>('orders')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [authBusy, setAuthBusy] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  // Set after a successful sign-up that still needs email confirmation. Held
  // in state (rather than shown as a toast) so the explanation stays on screen
  // for as long as the customer needs it.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  // Shown inline under the form when the address already has an account.
  const [authError, setAuthError] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  // Seconds until the resend button re-enables. Supabase rate-limits resends
  // to about one a minute, so the countdown reflects a real server limit
  // rather than an arbitrary UI delay.
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resetOpen, setResetOpen] = useState(false)
  // Registration now has a code step: signUp sends an 8-digit code, and the
  // account is not usable until it is entered. `pendingEmail` above holds the
  // address it went to.
  const [signupCode, setSignupCode] = useState('')
  const [googleBusy, setGoogleBusy] = useState(false)

  // Orders come from the server, keyed by the lookup tokens this browser
  // stored when each order was placed — so unpaid orders survive reloads and
  // can still be paid days later.
  const [myOrders, setMyOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    const mine = await fetchMyOrders()
    setMyOrders(mine)
    setOrdersLoading(false)
  }, [])

  useEffect(() => {
    if (panel === 'user') void loadOrders()
  }, [panel, loadOrders])

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setTimeout(() => setResendCooldown((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [resendCooldown])

  if (panel !== 'user') return null

  const unpaidCount = myOrders.filter(isUnpaid).length

  async function handleResend() {
    if (!pendingEmail || resending || resendCooldown > 0) return
    setResending(true)
    const { ok, message } = await resendConfirmation(pendingEmail)
    setResending(false)
    if (ok) {
      setResendCooldown(60)
      pushToast({ title: 'Письмо отправлено повторно', variant: 'success' })
    } else {
      // A 429 here means the previous email is still within the rate window —
      // start the cooldown anyway so the button stops inviting another try.
      if (message && /rate limit|429|too many/i.test(message)) setResendCooldown(60)
      pushToast({ title: message ?? 'Не удалось отправить письмо', variant: 'default' })
    }
  }

  async function handleVerifySignup(e: React.FormEvent) {
    e.preventDefault()
    if (authBusy || !pendingEmail) return
    setAuthBusy(true)
    setAuthError(null)
    try {
      const { ok, message } = await verifySignupCode(pendingEmail, signupCode)
      if (!ok) {
        // Supabase text is English-only; map it onto a localized message.
        setAuthError(
          message && /rate limit|too many|429/i.test(message)
            ? t('otp.err.rateLimit')
            : t('otp.err.codeInvalid'),
        )
        return
      }
      // Success signs the user in; onAuthStateChange swaps this panel over to
      // the account view on its own, so there is nothing further to do here.
      setSignupCode('')
      setPendingEmail(null)
      pushToast({ title: t('signup.verify.done'), variant: 'success' })
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleGoogle() {
    if (googleBusy) return
    setGoogleBusy(true)
    setAuthError(null)
    const { ok, message } = await signInWithGoogle()
    // On success the browser is already navigating to Google, so the spinner
    // is intentionally left running until the page unloads.
    if (!ok) {
      setGoogleBusy(false)
      setAuthError(message ?? t('auth.googleFailed'))
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    if (authBusy) return
    setAuthBusy(true)
    try {
      setAuthError(null)
      if (mode === 'login') {
        const ok = await login(form.email, form.password)
        // Only wipe the fields on success — clearing them after a failed
        // attempt forces the customer to retype an email that was probably
        // correct.
        if (ok) setForm({ name: '', email: '', password: '' })
      } else {
        const { ok, needsConfirmation, alreadyRegistered, message } = await register(
          form.name,
          form.email,
          form.password,
        )
        if (ok) {
          if (needsConfirmation) {
            setPendingEmail(form.email.trim())
            setResendCooldown(0)
          }
          setForm({ name: '', email: '', password: '' })
        } else if (alreadyRegistered) {
          // Keep the email in the field: the next thing they will almost
          // certainly do is sign in with it.
          setAuthError(
            'Этот email уже зарегистрирован. Войдите в аккаунт или восстановите пароль.',
          )
          setPendingEmail(null)
          setForm((f) => ({ ...f, password: '' }))
        } else if (message) {
          setAuthError(message)
        }
      }
    } finally {
      setAuthBusy(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm"
        onClick={() => setPanel(null)}
        aria-hidden
      />
      <div className="animate-slide-in-right fixed right-0 top-0 z-[70] flex h-full w-full max-w-lg flex-col border-l border-border bg-popover shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-serif text-lg font-bold tracking-tight text-foreground">
            {t('user.title')}
          </h2>
          <button
            type="button"
            onClick={() => setPanel(null)}
            className="text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {!currentUser ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-6">
            {/* Orders are tied to this browser, not to an account — so an
                unpaid order stays reachable even before signing in. */}
            {unpaidCount > 0 && (
              <div className="w-full max-w-sm">
                <AccountOrders
                  orders={myOrders}
                  loading={ordersLoading}
                  onReload={() => void loadOrders()}
                  unpaidOnly
                />
              </div>
            )}
            {/* Registration is not finished until the emailed code is entered,
                so while one is outstanding this REPLACES the sign-in form
                rather than sitting above it — two live forms would leave the
                customer unsure which one to act on. "Cancel sign-up" returns
                them to the normal tabs. */}
            {pendingEmail ? (
              <form
                onSubmit={handleVerifySignup}
                noValidate
                className="animate-fade-up w-full max-w-sm space-y-4 border border-gold/40 bg-gold/[0.06] p-5"
              >
                <div className="flex items-start gap-3">
                  <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.5} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-foreground">
                      {t('signup.verify.title')}
                    </h3>
                    <p className="mt-1.5 text-[12px] font-light leading-relaxed text-muted-foreground">
                      {tf('signup.verify.body', { email: pendingEmail })}
                    </p>
                  </div>
                </div>

                <OtpCodeInput
                  id="signup-code"
                  label={t('otp.step2.codeLabel')}
                  value={signupCode}
                  onChange={setSignupCode}
                  autoFocus
                  error={Boolean(authError)}
                />

                {authError && <p className="text-[12px] text-destructive">{authError}</p>}

                <button
                  type="submit"
                  disabled={authBusy || !isOtpComplete(signupCode)}
                  className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
                >
                  {authBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t('signup.verify.submit')}
                </button>

                <div className="flex flex-col gap-2 border-t border-gold/20 pt-3">
                  {resendCooldown > 0 ? (
                    <p className="text-center text-[11px] font-light text-muted-foreground/70">
                      {tf('otp.step2.resendIn', { n: resendCooldown })}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleResend()}
                      disabled={resending}
                      className="flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-gold underline-offset-4 transition hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resending && <Loader2 className="h-3 w-3 animate-spin" />}
                      {t('otp.step2.resend')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPendingEmail(null)
                      setSignupCode('')
                      setAuthError(null)
                    }}
                    className="text-center text-[11px] font-light text-muted-foreground transition hover:text-foreground"
                  >
                    {t('signup.verify.cancel')}
                  </button>
                </div>
              </form>
            ) : (
            <>
            <form onSubmit={handleAuth} className="w-full max-w-sm space-y-4">
              <div className="mb-6 flex rounded-lg border border-border p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login')
                    setAuthError(null)
                  }}
                  className={cn(
                    'flex-1 rounded-md py-2 text-sm font-medium transition',
                    mode === 'login' ? 'bg-gold/10 text-gold' : 'text-muted-foreground',
                  )}
                >
                  {t('user.login')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register')
                    setAuthError(null)
                  }}
                  className={cn(
                    'flex-1 rounded-md py-2 text-sm font-medium transition',
                    mode === 'register' ? 'bg-gold/10 text-gold' : 'text-muted-foreground',
                  )}
                >
                  {t('user.register')}
                </button>
              </div>

              {mode === 'register' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
                    {t('user.name')}
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
                  {t('user.email')}
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
                />
              </div>

              <PasswordInput
                label={t('user.password')}
                value={form.password}
                onChange={(v) => setForm({ ...form, password: v })}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />

              {/* Inline, not a toast: "this email is taken" is something the
                  customer needs to still be reading while they switch to the
                  sign-in tab. */}
              {authError && (
                <div className="border border-destructive/40 bg-destructive/5 px-3 py-2.5">
                  <p className="text-[12px] leading-relaxed text-destructive">
                    {authError}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login')
                        setAuthError(null)
                      }}
                      className="text-[11px] font-medium text-gold underline-offset-4 transition hover:underline"
                    >
                      Войти
                    </button>
                    <button
                      type="button"
                      onClick={() => setResetOpen(true)}
                      className="text-[11px] font-medium text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
                    >
                      {t('user.forgotPassword')}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy}
                className="flex w-full items-center justify-center gap-2 border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
              >
                {authBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {mode === 'login' ? t('user.login') : t('user.register')}
              </button>

              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => setResetOpen(true)}
                  className="block w-full text-center text-[11px] text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
                >
                  {t('user.forgotPassword')}
                </button>
              )}
            </form>

            {/* Social sign-in. Placed after the email form so the primary path
                stays primary, and shown in both modes: Google both creates and
                signs into an account, so a separate "sign up" variant would be
                a distinction without a difference. */}
            <div className="w-full max-w-sm">
              <div className="mb-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('auth.or')}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={() => void handleGoogle()}
                disabled={googleBusy}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-background py-3 text-sm font-medium text-foreground transition hover:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {googleBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GoogleMark />
                )}
                {t('auth.google')}
              </button>
            </div>
            </>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border px-6 py-4">
              <div className="flex size-12 items-center justify-center rounded-full bg-gold/10">
                <UserIcon className="size-6 text-gold" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{currentUser.name}</p>
                <p className="text-xs text-muted-foreground">{currentUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <LogOut className="size-3.5" />
                {t('user.logout')}
              </button>
            </div>

            <div className="flex gap-1 border-b border-border px-6 py-2">
              <TabButton active={tab === 'orders'} onClick={() => setTab('orders')} icon={<Package className="size-4" />}>
                {t('user.orders')}
                {unpaidCount > 0 && (
                  <span className="ml-1 border border-gold/40 bg-gold/10 px-1.5 text-[10px] text-gold">
                    {unpaidCount}
                  </span>
                )}
              </TabButton>
              <TabButton active={tab === 'profile'} onClick={() => setTab('profile')} icon={<UserIcon className="size-4" />}>
                {t('user.profile')}
              </TabButton>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {tab === 'orders' && (
                <AccountOrders
                  orders={myOrders}
                  loading={ordersLoading}
                  onReload={() => void loadOrders()}
                />
              )}

              {tab === 'profile' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="mb-3 font-serif text-base font-medium text-foreground">
                      {t('user.profile')}
                    </h3>
                    <div className="space-y-3">
                      <ProfileRow label={t('user.name')} value={currentUser.name} />
                      <ProfileRow label={t('user.email')} value={currentUser.email} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="mb-3 font-serif text-base font-medium text-foreground">
                      {t('user.orders')}
                    </h3>
                    <div className="flex items-center gap-4">
                      <div className="flex size-12 items-center justify-center rounded-full bg-gold/10">
                        <Package className="size-6 text-gold" />
                      </div>
                      <div>
                        <p className="text-2xl font-semibold text-foreground">{myOrders.length}</p>
                        <p className="text-xs text-muted-foreground">{t('admin.totalOrders')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <PasswordResetModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        // Carry over whatever they already typed so they do not retype it.
        initialEmail={form.email}
      />
    </>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition',
        active ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      {icon}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

/** Google's brand mark, inlined as SVG. An <img> would need a network fetch
 *  and would render as a broken icon while offline or blocked. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18A13.2 13.2 0 0 1 11 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  )
}
