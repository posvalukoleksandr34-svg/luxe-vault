'use client'

import { Mail, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { SupportTicket } from '@/lib/types'

/** Admin view for customer support messages submitted via the floating
 * support widget (/api/support POST). */
export function SupportManager() {
  const { pushToast } = useStore()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/support')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setTickets(data.tickets ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function toggleResolved(ticket: SupportTicket) {
    const nextStatus = ticket.status === 'open' ? 'resolved' : 'open'
    const previous = tickets
    setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status: nextStatus } : t)))
    try {
      const res = await fetch(`/api/admin/support/${encodeURIComponent(ticket.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) throw new Error('failed')
    } catch {
      setTickets(previous)
      pushToast({ title: 'Не удалось обновить обращение', variant: 'default' })
    }
  }

  async function handleDelete(id: string) {
    setConfirmDeleteId(null)
    const previous = tickets
    setTickets((prev) => prev.filter((t) => t.id !== id))
    try {
      const res = await fetch(`/api/admin/support/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      pushToast({ title: 'Обращение удалено', variant: 'default' })
    } catch {
      setTickets(previous)
      pushToast({ title: 'Не удалось удалить обращение', variant: 'default' })
    }
  }

  const openCount = tickets.filter((t) => t.status === 'open').length

  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-semibold text-foreground">Поддержка</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {openCount > 0 ? `${openCount} открытых обращений` : 'Открытых обращений нет'}
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Обращений пока нет</p>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{ticket.name}</p>
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                        ticket.status === 'open'
                          ? 'text-amber-400 bg-amber-400/10 border-amber-400/30'
                          : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
                      )}
                    >
                      {ticket.status === 'open' ? 'Открыто' : 'Решено'}
                    </span>
                  </div>
                  <a
                    href={`mailto:${ticket.email}`}
                    className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-gold"
                  >
                    <Mail className="size-3" />
                    {ticket.email}
                  </a>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(ticket.createdAt).toLocaleString('ru-RU')}
                </span>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">{ticket.message}</p>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleResolved(ticket)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" />
                  {ticket.status === 'open' ? 'Отметить решённым' : 'Вернуть в открытые'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(ticket.id)}
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-destructive"
                  aria-label="Удалить обращение"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setConfirmDeleteId(null)}
            aria-hidden
          />
          <div className="animate-fade-up relative w-full max-w-sm border border-border bg-popover p-6 shadow-2xl">
            <h3 className="font-serif text-lg font-bold text-foreground">Удалить обращение?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Это действие нельзя отменить.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 border border-border py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 border border-destructive/40 bg-destructive/10 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
