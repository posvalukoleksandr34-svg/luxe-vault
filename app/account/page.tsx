'use client'

import {
  Loader2,
  LogIn,
  MapPin,
  Package,
  Settings,
  User as UserIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { AccountOrders } from '@/components/account-orders'
import { PasswordForm } from '@/components/account/password-form'
import { ProfileForm } from '@/components/account/profile-form'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { ProductCard } from '@/components/products/product-card'
import { SavedAddresses } from '@/components/saved-addresses'
import { SavedCards } from '@/components/saved-cards'
import { fetchMyOrders } from '@/lib/order-registry'
import { useStore } from '@/lib/store'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Order } from '@/lib/types'

/**
 * The account dashboard.
 *
 * The account UI already existed as a right-hand drawer (components/
 * user-panel.tsx), which is right for a quick look at an order mid-browse and
 * wrong for everything else: 448px cannot hold an address book and a profile
 * form, and a drawer has no URL, so "my orders" could not be linked to,
 * bookmarked, or returned to after a redirect.
 *
 * This is a real route beside it, not a replacement — the drawer stays for the
 * quick path. Both read the same components, so there is one implementation of
 * each thing rather than two that drift.
 *
 * The tab lives in the query string so a customer can be sent straight to
 * /account?tab=orders, and so the browser's back button steps through tabs the
 * way it looks like it should.
 */

type TabKey = 'profile' | 'orders' | 'addresses' | 'settings'

const TABS: { key: TabKey; icon: typeof UserIcon; labelKey: Parameters<ReturnType<typeof useStore>['t']>[0] }[] = [
  { key: 'profile', icon: UserIcon, labelKey: 'account.profile' },
  { key: 'orders', icon: Package, labelKey: 'user.orders' },
  { key: 'addresses', icon: MapPin, labelKey: 'address.title' },
  { key: 'settings', icon: Settings, labelKey: 'account.settings' },
]

export default function AccountPage() {
  return (
    <Suspense fallback={<Shell><Spinner /></Shell>}>
      <AccountDashboard />
    </Suspense>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        {children}
      </main>
      <Footer />
    </>
  )
}

function Spinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="size-5 animate-spin text-gold" />
    </div>
  )
}

function AccountDashboard() {
  const { currentUser, authLoading, t, setPanel } = useStore()
  const router = useRouter()
  const params = useSearchParams()

  const requested = params.get('tab') as TabKey | null
  const tab: TabKey = TABS.some((x) => x.key === requested) ? (requested as TabKey) : 'profile'

  function goTo(next: TabKey) {
    // replace, not push: stepping back through five tabs to leave the page is
    // not what the back button is for.
    router.replace(next === 'profile' ? '/account' : `/account?tab=${next}`, { scroll: false })
  }

  // Waiting for the session to settle, so an already-signed-in customer is
  // never shown the sign-in prompt for a frame.
  if (authLoading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    )
  }

  if (!currentUser) {
    return (
      <Shell>
        <div className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-5 text-center">
          <LogIn className="size-8 text-muted-foreground/30" strokeWidth={1.25} />
          <p className="text-sm font-light text-muted-foreground">
            {t('account.signInRequired')}
          </p>
          <button
            type="button"
            onClick={() => setPanel('user')}
            className="border border-gold/40 bg-gold/5 px-6 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('user.login')}
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="mb-8 border-b border-border/50 pb-6">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
          {t('account.title')}
        </h1>
        <p className="mt-1.5 text-[13px] font-light text-muted-foreground">
          {currentUser.name} · {currentUser.email}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        {/* Sidebar. A horizontal scroller on phones, where a 200px rail would
            eat a third of the screen. */}
        <nav
          aria-label={t('account.title')}
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {TABS.map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              type="button"
              onClick={() => goTo(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2.5 border-l-2 px-3 py-2.5 text-left text-[13px] transition-colors duration-200',
                tab === key
                  ? 'border-gold bg-gold/5 text-gold'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.5} />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'orders' && <OrdersTab />}
          {tab === 'addresses' && <SavedAddresses />}
          {tab === 'settings' && <PasswordForm />}
        </div>
      </div>
    </Shell>
  )
}

// ------------------------------------------------------------------ profile

/**
 * Name and email.
 *
 * The name is written to the profile row; the email goes through Supabase
 * Auth, which owns identity. Changing an email does NOT take effect
 * immediately — Supabase sends a confirmation link to the new address, and the
 * old one keeps working until it is clicked. Saying so is the whole point of
 * the notice: without it the customer sees "saved", sees the old address still
 * shown, and assumes it failed.
 */
function ProfileTab() {
  const { currentUser, t, pushToast } = useStore()

  const [name, setName] = useState(currentUser?.name ?? '')
  const [email, setEmail] = useState(currentUser?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [emailPending, setEmailPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(currentUser?.name ?? '')
    setEmail(currentUser?.email ?? '')
  }, [currentUser])

  async function save() {
    if (saving || !currentUser) return
    setSaving(true)
    setError(null)
    setEmailPending(false)

    const supabase = createClient()
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    try {
      if (trimmedName && trimmedName !== currentUser.name) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ name: trimmedName })
          .eq('id', currentUser.id)
        if (profileError) throw new Error(profileError.message)

        // Kept in step with the profile row: the signUp metadata is what the
        // welcome and recovery emails read, and a name that disagrees between
        // the two is the kind of thing nobody notices until a customer does.
        await supabase.auth.updateUser({ data: { name: trimmedName } })
      }

      if (trimmedEmail && trimmedEmail !== currentUser.email) {
        const { error: authError } = await supabase.auth.updateUser({ email: trimmedEmail })
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
    <div className="space-y-4">
      <section className="card-gold p-5">
        <h2 className="mb-4 font-serif text-lg font-medium text-foreground">
          {t('account.profile')}
        </h2>

        <div className="max-w-md space-y-3">
          <Labelled label={t('user.name')}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="w-full border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-gold"
            />
          </Labelled>

          <Labelled label={t('user.email')}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-gold"
            />
          </Labelled>

          {emailPending && (
            <p className="border border-gold/40 bg-gold/5 px-3 py-2.5 text-[12px] font-light text-gold">
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
            disabled={saving}
            className="flex items-center gap-2 border border-gold/40 bg-gold/5 px-6 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('account.save')}
          </button>
        </div>
      </section>

      <SavedCards />
    </div>
  )
}

// ------------------------------------------------------------------- orders

function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      setOrders(await fetchMyOrders())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // The same component the drawer uses, so the status timeline, the pay-now
  // retry, cancellation and refund requests all behave identically in both
  // places rather than being implemented twice.
  return <AccountOrders orders={orders} loading={loading} onReload={load} />
}



function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}
