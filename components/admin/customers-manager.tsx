'use client'

import { Loader2, Search, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatPrice } from '@/lib/store'

/**
 * The customer list.
 *
 * Answers one question — who is worth looking after — so it sorts by net spend
 * and shows the figures that support that: orders placed, orders actually
 * paid, and when they last bought.
 *
 * Read-only on purpose. There is no "edit customer" here because there is
 * nothing an admin should be changing about someone else's account: the name
 * and email belong to the customer, and their addresses and cards are theirs
 * to manage. A panel that can edit them is a panel that can be misused.
 */

type Customer = {
  id: string
  name: string
  email: string
  registeredAt: number
  orders: number
  paidOrders: number
  spent: number
  lastOrderAt: number | null
}

export function CustomersManager() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch('/api/admin/customers')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCustomers(d?.customers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    )
  }, [customers, query])

  const totals = useMemo(
    () => ({
      revenue: customers.reduce((sum, c) => sum + c.spent, 0),
      buyers: customers.filter((c) => c.orders > 0).length,
    }),
    [customers],
  )

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-6">
          <Stat label="Клиентов" value={String(customers.length)} />
          <Stat label="Покупали" value={String(totals.buyers)} />
          <Stat label="Выручка" value={formatPrice(totals.revenue)} accent />
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или email"
            aria-label="Поиск клиентов"
            className="w-56 rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground outline-none focus:border-gold"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Users className="size-6 text-muted-foreground/25" strokeWidth={1.25} />
          <p className="text-[13px] text-muted-foreground">
            {customers.length === 0 ? 'Клиентов пока нет' : 'Ничего не найдено'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[46rem] text-left text-[13px]">
            <thead className="bg-background/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-normal">Клиент</th>
                <th className="px-4 py-3 font-normal">Заказы</th>
                <th className="px-4 py-3 font-normal">Оплачено</th>
                <th className="px-4 py-3 text-right font-normal">Потрачено</th>
                <th className="px-4 py-3 font-normal">Последний заказ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-border/60">
                  <td className="px-4 py-3">
                    <span className="block text-foreground">{c.name || '—'}</span>
                    <span className="block text-[11px] text-muted-foreground/70">{c.email}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{c.orders}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{c.paidOrders}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gold">
                    {formatPrice(c.spent)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground/70">
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('ru-RU') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/60">
        Потрачено — за вычетом возвратов; отменённые заказы не учитываются.
      </p>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={accent ? 'text-lg text-gold' : 'text-lg text-foreground'}>{value}</p>
    </div>
  )
}
