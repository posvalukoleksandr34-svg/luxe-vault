import type { Attention } from '@/lib/admin-attention'

/**
 * The console's navigation, in one place: every admin page, grouped by the
 * job it belongs to. The shell (components/admin/admin-shell.tsx) renders it
 * on every page; the dashboard links into the same addresses.
 *
 * Some sections are their own routes (/admin/orders); the older ones are
 * views of /admin chosen by `?tab=` — both are ordinary links, so a section
 * can be bookmarked, reloaded and opened in a new tab.
 */

export type AdminTab =
  | 'dashboard'
  | 'products'
  | 'collections'
  | 'inventory'
  | 'customers'
  | 'reviews'
  | 'productReviews'
  | 'support'

export const ADMIN_TABS: AdminTab[] = [
  'dashboard',
  'products',
  'collections',
  'inventory',
  'customers',
  'reviews',
  'productReviews',
  'support',
]

export function tabFrom(value: string | null | undefined): AdminTab {
  return (ADMIN_TABS as string[]).includes(value ?? '') ? (value as AdminTab) : 'dashboard'
}

export type NavIcon =
  | 'dashboard'
  | 'orders'
  | 'returns'
  | 'reconciliation'
  | 'customers'
  | 'promos'
  | 'products'
  | 'collections'
  | 'inventory'
  | 'support'
  | 'productReviews'
  | 'reviews'
  | 'reviewRequests'
  | 'newsletter'
  | 'shipping'

export type NavItem = {
  key: string
  label: string
  href: string
  icon: NavIcon
  /** Which attention count, if any, is shown beside it. */
  badge?: (a: Attention) => number | null
  /** Shown red: something waits on a person, not just information. */
  urgent?: boolean
}

export type NavGroup = { label: string | null; items: NavItem[] }

export const ADMIN_NAV: NavGroup[] = [
  {
    label: null,
    items: [{ key: 'dashboard', label: 'Обзор', href: '/admin', icon: 'dashboard' }],
  },
  {
    label: 'Продажи',
    items: [
      { key: 'orders', label: 'Заказы', href: '/admin/orders', icon: 'orders', badge: (a) => a.ordersToShip, urgent: true },
      { key: 'returns', label: 'Возвраты', href: '/admin/returns', icon: 'returns', badge: (a) => a.refundCasesWaiting, urgent: true },
      { key: 'reconciliation', label: 'Сверка платежей', href: '/admin/reconciliation', icon: 'reconciliation' },
      { key: 'customers', label: 'Клиенты', href: '/admin?tab=customers', icon: 'customers' },
      { key: 'promos', label: 'Промокоды', href: '/admin/promocodes', icon: 'promos' },
    ],
  },
  {
    label: 'Каталог',
    items: [
      { key: 'products', label: 'Товары', href: '/admin?tab=products', icon: 'products' },
      { key: 'collections', label: 'Разделы и категории', href: '/admin?tab=collections', icon: 'collections' },
      { key: 'inventory', label: 'Остатки', href: '/admin?tab=inventory', icon: 'inventory', badge: (a) => a.outOfStock },
    ],
  },
  {
    label: 'Покупатели и отзывы',
    items: [
      { key: 'support', label: 'Поддержка', href: '/admin?tab=support', icon: 'support', badge: (a) => a.supportWaiting, urgent: true },
      { key: 'productReviews', label: 'Отзывы о товарах', href: '/admin?tab=productReviews', icon: 'productReviews', badge: (a) => a.productReviewsPending },
      { key: 'reviews', label: 'Отзывы о магазине', href: '/admin?tab=reviews', icon: 'reviews', badge: (a) => a.storeReviewsPending },
      { key: 'reviewRequests', label: 'Запросы отзывов', href: '/admin/review-requests', icon: 'reviewRequests', badge: (a) => a.reviewRequestsFailed },
    ],
  },
  {
    label: 'Маркетинг и настройки',
    items: [
      { key: 'newsletter', label: 'Рассылка', href: '/admin/newsletter', icon: 'newsletter' },
      { key: 'shipping', label: 'Доставка', href: '/admin/settings', icon: 'shipping' },
    ],
  },
]

/** The nav item a location belongs to. Sub-pages count as their section. */
export function activeNavKey(pathname: string, tab: string | null): string {
  if (pathname === '/admin' || pathname === '/admin/') return tabFrom(tab)
  if (pathname.startsWith('/admin/orders')) return 'orders'
  if (pathname.startsWith('/admin/returns')) return 'returns'
  if (pathname.startsWith('/admin/reconciliation')) return 'reconciliation'
  if (pathname.startsWith('/admin/promocodes')) return 'promos'
  if (pathname.startsWith('/admin/review-requests')) return 'reviewRequests'
  if (pathname.startsWith('/admin/newsletter')) return 'newsletter'
  if (pathname.startsWith('/admin/settings')) return 'shipping'
  return 'dashboard'
}

export function navItem(key: string): NavItem | undefined {
  for (const g of ADMIN_NAV) for (const i of g.items) if (i.key === key) return i
  return undefined
}
