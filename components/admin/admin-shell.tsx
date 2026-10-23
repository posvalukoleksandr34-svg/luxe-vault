'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Boxes,
  ExternalLink,
  Images,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Mail,
  MailCheck,
  Menu,
  MessageSquareWarning,
  Package,
  RotateCcw,
  Star,
  Tag,
  Truck,
  Users,
  Settings2,
  X,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import type { Attention } from '@/lib/admin-attention'
import { ADMIN_NAV, activeNavKey, navItem, type NavIcon } from '@/lib/admin-nav'
import { cn } from '@/lib/utils'

/**
 * The console's frame, around every admin page (app/admin/layout.tsx): the
 * grouped navigation, always in the same place, with the counts of what is
 * waiting; a menu drawer on phones; the way out.
 *
 * Every section used to be either a tab of /admin or its own page with a
 * "back to the panel" link and no navigation at all — so going from an order
 * to the stock of the item in it was three clicks through the dashboard.
 *
 * Also the console's look: `data-admin-shell` switches the theme tokens to
 * neutral greys and black (app/globals.css), so every admin component, dialog
 * and toast follows without being restyled one by one.
 */

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  orders: Truck,
  returns: RotateCcw,
  customers: Users,
  promos: Tag,
  products: Package,
  collections: Images,
  inventory: Boxes,
  support: LifeBuoy,
  productReviews: MessageSquareWarning,
  reviews: Star,
  reviewRequests: MailCheck,
  newsletter: Mail,
  shipping: Settings2,
}

type AttentionState = { attention: Attention | null; failed: boolean; refresh: () => void }

const AttentionContext = createContext<AttentionState>({ attention: null, failed: false, refresh: () => {} })

/** The counts the navigation shows, for the dashboard to reuse. */
export function useAdminAttention(): AttentionState {
  return useContext(AttentionContext)
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/admin'
  const params = useSearchParams()
  const tab = params?.get('tab') ?? null
  const isLogin = pathname.startsWith('/admin/login')

  const [attention, setAttention] = useState<Attention | null>(null)
  const [failed, setFailed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const lastFetch = useRef(0)

  const refresh = useCallback(() => {
    lastFetch.current = Date.now()
    fetch('/api/admin/attention', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((a: Attention) => {
        setAttention(a)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])

  // On arrival and when moving between sections, at most every 30 seconds:
  // fresh enough to trust, cheap enough not to matter.
  useEffect(() => {
    if (isLogin) return
    if (Date.now() - lastFetch.current > 30_000) refresh()
  }, [pathname, tab, isLogin, refresh])

  // A link in the drawer closes it.
  useEffect(() => setDrawerOpen(false), [pathname, tab])

  if (isLogin) return <>{children}</>

  const active = activeNavKey(pathname, tab)
  const current = navItem(active)

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/'
  }

  const nav = (
    <nav aria-label="Разделы админ-панели" className="space-y-4">
      {ADMIN_NAV.map((group, gi) => (
        <div key={gi}>
          {group.label && (
            <p className="mb-1.5 px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {group.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon]
              const count = attention && item.badge ? item.badge(attention) : null
              const isActive = item.key === active
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 text-sm transition lg:min-h-[36px]',
                      isActive
                        ? 'bg-foreground font-medium text-background'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {count !== null && count > 0 && (
                      <span
                        className={cn(
                          'min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums',
                          isActive
                            ? 'bg-background/20 text-background'
                            : item.urgent
                              ? 'bg-red-600 text-white'
                              : 'bg-muted text-foreground',
                        )}
                      >
                        <span className="sr-only">ждут: </span>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  const footer = (
    <div className="space-y-1 border-t border-border pt-4">
      <a
        href="/"
        target="_blank"
        rel="noopener"
        className="flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground lg:min-h-[36px]"
      >
        <ExternalLink className="size-4" aria-hidden />
        Открыть магазин
      </a>
      <button
        type="button"
        onClick={() => void logout()}
        className="flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground lg:min-h-[36px]"
      >
        <LogOut className="size-4" aria-hidden />
        Выйти
      </button>
    </div>
  )

  return (
    <AttentionContext.Provider value={{ attention, failed, refresh }}>
      <div data-admin-shell className="min-h-[100dvh] bg-background lg:flex">
        {/* Desktop: the navigation stays put while the page scrolls. */}
        <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-card px-3 py-4 lg:flex">
          <Link href="/admin" className="px-3 text-[15px] font-semibold tracking-tight text-foreground">
            Luxe Vault <span className="font-normal text-muted-foreground">· админ</span>
          </Link>
          <div className="flex-1">{nav}</div>
          {footer}
        </aside>

        {/* Phones and tablets: a bar with the section's name and the menu. */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-3 backdrop-blur lg:hidden">
          <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogPrimitive.Trigger
              className="flex size-10 items-center justify-center rounded-lg text-foreground hover:bg-accent"
              aria-label="Меню разделов"
            >
              <Menu className="size-5" aria-hidden />
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/40" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-[91] flex w-[min(20rem,88vw)] flex-col gap-5 overflow-y-auto bg-card px-3 py-4 shadow-2xl focus:outline-none">
                <div className="flex items-center justify-between px-3">
                  <DialogPrimitive.Title className="text-[15px] font-semibold text-foreground">Luxe Vault · админ</DialogPrimitive.Title>
                  <DialogPrimitive.Close className="flex size-10 items-center justify-center rounded-lg hover:bg-accent" aria-label="Закрыть меню">
                    <X className="size-5" aria-hidden />
                  </DialogPrimitive.Close>
                </div>
                <DialogPrimitive.Description className="sr-only">Разделы админ-панели</DialogPrimitive.Description>
                <div className="flex-1">{nav}</div>
                {footer}
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <span className="truncate text-sm font-medium text-foreground">{current?.label ?? 'Админ-панель'}</span>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {failed && (
            <p role="status" className="mb-4 text-xs text-muted-foreground">
              Счётчики в меню не загрузились — разделы работают, обновите страницу позже.
            </p>
          )}
          {children}
        </main>
      </div>
    </AttentionContext.Provider>
  )
}

/** One shape for every page's title row: what this is, and its main actions. */
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
