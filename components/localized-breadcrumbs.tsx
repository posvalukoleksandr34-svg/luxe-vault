'use client'

import { Breadcrumbs } from '@/components/breadcrumbs'
import type { UIKey } from '@/lib/i18n'
import { useStore } from '@/lib/store'

/**
 * A breadcrumb trail named by dictionary keys, rendered in the visitor's
 * language — for server pages whose trail is fixed words ("Shop", "Stylist")
 * that would otherwise be hardcoded English on every locale. The page's
 * BreadcrumbList JSON-LD, where it has one, stays on the server.
 */
export function LocalizedBreadcrumbs({ items }: { items: { key: UIKey; url: string }[] }) {
  const { t } = useStore()
  return <Breadcrumbs trail={items.map((item) => ({ name: t(item.key), url: item.url }))} />
}
