'use client'

import {
  LogOut,
  Package,
  User as UserIcon,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AccountOrders, isUnpaid } from '@/components/account-orders'
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
    logout,
    t,
  } = useStore()

  const [tab, setTab] = useState<Tab>('orders')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })

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

  if (panel !== 'user') return null

  const unpaidCount = myOrders.filter(isUnpaid).length

  function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'login') {
      login(form.email, form.password)
    } else {
      register(form.name, form.email, form.password)
    }
    setForm({ name: '', email: '', password: '' })
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
            <form onSubmit={handleAuth} className="w-full max-w-sm space-y-4">
              <div className="mb-6 flex rounded-lg border border-border p-1">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={cn(
                    'flex-1 rounded-md py-2 text-sm font-medium transition',
                    mode === 'login' ? 'bg-gold/10 text-gold' : 'text-muted-foreground',
                  )}
                >
                  {t('user.login')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
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

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
                  {t('user.password')}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
                />
              </div>

              <button
                type="submit"
                className="w-full border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
              >
                {mode === 'login' ? t('user.login') : t('user.register')}
              </button>

              <p className="text-center text-xs text-muted-foreground">
                Демо: demo@luxe.vault / demo123
              </p>
            </form>
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
                onClick={logout}
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
