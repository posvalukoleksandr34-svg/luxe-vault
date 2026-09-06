'use client'

import { AlertTriangle, Bell, Check, Loader2, Package } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Notification } from '@/lib/types'

/**
 * Notification bell and panel.
 *
 * Renders nothing at all for signed-out visitors: notifications are per
 * account, so a bell that could only ever be empty is noise in the header.
 *
 * Polling rather than realtime, deliberately. The events behind these — a
 * payment failing, an admin marking a parcel shipped — happen minutes or days
 * apart, so a websocket would hold a connection open on every page for an
 * update that arrives twice a week. A 60s poll while the tab is visible costs
 * one cheap indexed query and is well inside what "prompt" means here.
 */
export function NotificationCenter() {
  const { currentUser, locale } = useStore()

  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json()
      setItems(Array.isArray(data.notifications) ? data.notifications : [])
      setUnread(typeof data.unreadCount === 'number' ? data.unreadCount : 0)
    } catch {
      // Offline or a blip. Whatever is already on screen stays; a bell that
      // empties itself on a dropped request looks like the news was deleted.
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) {
      setItems([])
      setUnread(0)
      return
    }
    void load()

    // Paused while the tab is hidden — a background tab left open overnight
    // would otherwise fire hundreds of pointless requests.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 60_000)
    return () => clearInterval(id)
  }, [currentUser, load])

  // Close on outside click, so the panel never sits over the page.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  async function markAllRead() {
    // Optimistic: the request is idempotent and the badge is the thing the
    // customer is watching, so it should clear on the tap, not a round trip
    // later. A failure re-syncs on the next poll.
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setUnread(0)
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
    } catch {
      void load()
    }
  }

  async function markOneRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
    setUnread((n) => Math.max(0, n - 1))
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })
    } catch {
      void load()
    }
  }

  if (!currentUser) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void load()
        }}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex size-9 items-center justify-center text-muted-foreground transition hover:text-foreground"
      >
        <Bell className="size-[18px]" strokeWidth={1.5} />
        {unread > 0 && (
          <span className="glow-breathe absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-gold text-[9px] font-bold text-gold-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-catcher sits below the panel but above the page. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="animate-scale-in absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] border border-border bg-popover shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Уведомления
              </span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-gold/80 transition hover:text-gold"
                >
                  <Check className="size-3" />
                  Прочитать всё
                </button>
              )}
            </div>

            <div className="max-h-[26rem] overflow-y-auto">
              {loading && items.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="size-4 animate-spin text-gold/60" />
                </div>
              ) : items.length === 0 ? (
                <p className="px-4 py-10 text-center text-[12px] font-light text-muted-foreground">
                  Пока нет уведомлений
                </p>
              ) : (
                <ul className="divide-y divide-border/40">
                  {items.map((n) => {
                    const Icon = n.type === 'payment_failed' ? AlertTriangle : Package
                    const row = (
                      <div
                        className={cn(
                          'flex items-start gap-3 px-4 py-3.5 transition-colors',
                          !n.isRead && 'bg-gold/[0.04]',
                        )}
                      >
                        <Icon
                          className={cn(
                            'mt-0.5 size-3.5 shrink-0',
                            n.type === 'payment_failed' ? 'text-destructive' : 'text-gold/70',
                          )}
                          strokeWidth={1.5}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'text-[12px] leading-snug',
                              n.isRead ? 'font-light text-muted-foreground' : 'text-foreground',
                            )}
                          >
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="mt-1 text-[11px] font-light leading-relaxed text-muted-foreground/70">
                              {n.body}
                            </p>
                          )}
                          <p className="mt-1.5 text-[10px] tabular-nums text-muted-foreground/50">
                            {new Date(n.createdAt).toLocaleString(locale)}
                          </p>
                        </div>
                        {!n.isRead && (
                          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
                        )}
                      </div>
                    )

                    return (
                      <li key={n.id}>
                        {n.actionUrl ? (
                          <Link
                            href={n.actionUrl}
                            onClick={() => {
                              if (!n.isRead) void markOneRead(n.id)
                              setOpen(false)
                            }}
                            className="no-juice block hover:bg-accent/40"
                          >
                            {row}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => !n.isRead && void markOneRead(n.id)}
                            className="no-juice block w-full text-left hover:bg-accent/40"
                          >
                            {row}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
