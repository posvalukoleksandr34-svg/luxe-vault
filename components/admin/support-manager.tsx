'use client'

import { ArrowLeft, FileText, Loader2, Mail, Paperclip, Search, Send, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ACCEPTED_TYPES, MAX_FILES, MAX_TOTAL_BYTES, formatBytes, prepareAttachment } from '@/lib/support/client'
import { useStore } from '@/lib/store'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
  type SupportAttachment,
  type SupportCategory,
  type SupportTicket,
  type SupportTicketDetail,
  type SupportTicketStatus,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_RU: Record<SupportTicketStatus, string> = {
  open: 'Открыто',
  in_progress: 'В работе',
  waiting_user: 'Ждём клиента',
  resolved: 'Решено',
  closed: 'Закрыто',
}

const CATEGORY_RU: Record<SupportCategory, string> = {
  order: 'Заказ',
  payment: 'Оплата',
  shipping: 'Доставка',
  returns: 'Возврат',
  sizes: 'Размеры',
  product: 'Товар',
  account: 'Аккаунт',
  other: 'Другое',
}

const STATUS_STYLE: Record<SupportTicketStatus, string> = {
  open: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  in_progress: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
  waiting_user: 'text-gold bg-gold/10 border-gold/30',
  resolved: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  closed: 'text-muted-foreground bg-muted/30 border-border',
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

const INPUT =
  'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-gold/50'

function StatusBadge({ status }: { status: SupportTicketStatus }) {
  return (
    <span className={cn('whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium', STATUS_STYLE[status])}>
      {STATUS_RU[status]}
    </span>
  )
}

/**
 * Admin support desk: the queue with status and category filters and search,
 * the conversation, replies (which email the customer) and status changes.
 */
export function SupportManager() {
  const { pushToast } = useStore()
  const [status, setStatus] = useState<SupportTicketStatus | 'all'>('all')
  const [category, setCategory] = useState<SupportCategory | ''>('')
  const [q, setQ] = useState('')
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [counts, setCounts] = useState<Record<SupportTicketStatus, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    const sp = new URLSearchParams()
    if (status !== 'all') sp.set('status', status)
    if (category) sp.set('category', category)
    if (q.trim()) sp.set('q', q.trim())
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/support?${sp.toString()}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'failed')
      setTickets(data.tickets ?? [])
      setCounts(data.counts ?? null)
    } catch (e) {
      pushToast({ title: 'Не удалось загрузить обращения', description: (e as Error).message, variant: 'default' })
    } finally {
      setLoading(false)
    }
  }, [status, category, q, pushToast])

  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 300 : 0)
    return () => clearTimeout(id)
  }, [load, q])

  async function open(id: string) {
    setSelected(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/support/${encodeURIComponent(id)}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'failed')
      setDetail(data.ticket)
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, unread: false } : t)))
    } catch (e) {
      pushToast({ title: 'Не удалось открыть обращение', description: (e as Error).message, variant: 'default' })
      setSelected(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function changeStatus(next: SupportTicketStatus) {
    if (!detail || next === detail.status) return
    const previous = detail
    setDetail({ ...detail, status: next })
    try {
      const res = await fetch(`/api/admin/support/${encodeURIComponent(detail.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) throw new Error('failed')
      setTickets((prev) => prev.map((t) => (t.id === detail.id ? { ...t, status: next } : t)))
      void load()
    } catch {
      setDetail(previous)
      pushToast({ title: 'Не удалось изменить статус', variant: 'default' })
    }
  }

  function onReplied(ticket: SupportTicketDetail, emailed: boolean) {
    setDetail(ticket)
    setTickets((prev) => [ticket, ...prev.filter((t) => t.id !== ticket.id)])
    void load()
    pushToast({
      title: emailed ? 'Ответ отправлен — клиент получит письмо' : 'Ответ сохранён, но письмо не отправлено',
      variant: emailed ? 'success' : 'default',
    })
  }

  async function handleDelete() {
    if (!detail) return
    setConfirmDelete(false)
    try {
      const res = await fetch(`/api/admin/support/${encodeURIComponent(detail.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      setTickets((prev) => prev.filter((t) => t.id !== detail.id))
      setSelected(null)
      setDetail(null)
      void load()
      pushToast({ title: 'Обращение удалено', variant: 'default' })
    } catch {
      pushToast({ title: 'Не удалось удалить обращение', variant: 'default' })
    }
  }

  const total = counts ? SUPPORT_TICKET_STATUSES.reduce((s, k) => s + counts[k], 0) : tickets.length
  const needsTeam = counts ? counts.open + counts.in_progress : 0

  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-semibold text-foreground">Поддержка</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {needsTeam > 0 ? `Ждут ответа команды: ${needsTeam}` : 'Все обращения обработаны'}
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {(['all', ...SUPPORT_TICKET_STATUSES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition',
              status === s
                ? 'border-gold/50 bg-gold/10 text-gold'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {s === 'all' ? 'Все' : STATUS_RU[s]}
            <span className="ml-1.5 tabular-nums opacity-70">{s === 'all' ? total : counts?.[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as SupportCategory | '')}
          className={INPUT}
          aria-label="Категория"
        >
          <option value="">Все категории</option>
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_RU[c]}
            </option>
          ))}
        </select>
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="admin-support-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Номер, email, имя или тема"
            className={cn(INPUT, 'w-full pl-9')}
          />
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className={cn('space-y-2', selected && 'hidden lg:block')}>
          {loading && tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          ) : tickets.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              Обращений не найдено
            </p>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void open(t.id)}
                className={cn(
                  'w-full rounded-2xl border bg-card p-4 text-left transition hover:border-gold/30',
                  selected === t.id ? 'border-gold/50' : 'border-border',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    {t.unread && <span className="size-2 rounded-full bg-gold" aria-label="Новое сообщение" />}
                    {t.number}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{when(t.lastMessageAt)}</span>
                </div>
                <p className={cn('mt-1.5 truncate text-sm', t.unread ? 'font-semibold text-foreground' : 'text-foreground/90')}>
                  {t.subject}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {t.name} · {CATEGORY_RU[t.category]}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
              </button>
            ))
          )}
        </div>

        <div className={cn(!selected && 'hidden lg:block')}>
          {!selected ? (
            <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              Выберите обращение слева
            </div>
          ) : detailLoading || !detail ? (
            <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-border bg-card">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <AdminTicket
              key={detail.id}
              ticket={detail}
              onBack={() => {
                setSelected(null)
                setDetail(null)
              }}
              onStatus={(s) => void changeStatus(s)}
              onReplied={onReplied}
              onDelete={() => setConfirmDelete(true)}
            />
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setConfirmDelete(false)}
            aria-hidden
          />
          <div className="animate-fade-up relative w-full max-w-sm border border-border bg-popover p-6 shadow-2xl">
            <h3 className="font-serif text-lg font-bold text-foreground">Удалить обращение?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Переписка и вложения будут удалены без возможности восстановления.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 border border-border py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
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

function Attachments({ items }: { items: SupportAttachment[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((a) =>
        a.url && a.type.startsWith('image/') && !/hei[cf]/.test(a.type) ? (
          <a key={a.path} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name} className="size-24 rounded-lg border border-border object-cover" />
          </a>
        ) : (
          <a
            key={a.path}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-foreground/85 transition hover:text-gold"
          >
            <FileText className="size-3.5" />
            <span className="max-w-[14rem] truncate">{a.name}</span>
            <span className="text-muted-foreground">{formatBytes(a.size)}</span>
          </a>
        ),
      )}
    </div>
  )
}

function AdminTicket({
  ticket,
  onBack,
  onStatus,
  onReplied,
  onDelete,
}: {
  ticket: SupportTicketDetail
  onBack: () => void
  onStatus: (s: SupportTicketStatus) => void
  onReplied: (t: SupportTicketDetail, emailed: boolean) => void
  onDelete: () => void
}) {
  const [reply, setReply] = useState('')
  const [nextStatus, setNextStatus] = useState<SupportTicketStatus>('waiting_user')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    const incoming = Array.from(list)
    if (incoming.some((f) => ACCEPTED_TYPES.indexOf(f.type) === -1)) return setError('Только фото и PDF')
    if (files.length + incoming.length > MAX_FILES) return setError(`Не более ${MAX_FILES} файлов`)
    const prepared = await Promise.all(incoming.map(prepareAttachment))
    const all = [...files, ...prepared]
    if (all.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) return setError('Вложения вместе — до 4 МБ')
    setError(null)
    setFiles(all)
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (sending || !reply.trim()) return
    setSending(true)
    setError(null)
    const form = new FormData()
    form.set('message', reply.trim())
    form.set('status', nextStatus)
    files.forEach((f) => form.append('files', f, f.name))
    try {
      const res = await fetch(`/api/admin/support/${encodeURIComponent(ticket.id)}/messages`, { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Не удалось отправить ответ')
      setReply('')
      setFiles([])
      onReplied(data.ticket, Boolean(data.emailed))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-b border-border p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="size-3.5" />
              К списку
            </button>
            <p className="font-mono text-xs text-muted-foreground">{ticket.number}</p>
            <h2 className="mt-1 break-words font-serif text-xl font-semibold text-foreground">{ticket.subject}</h2>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-destructive"
            aria-label="Удалить обращение"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Клиент</dt>
            <dd className="min-w-0 text-foreground">
              {ticket.name} ·{' '}
              <a href={`mailto:${ticket.email}`} className="inline-flex items-center gap-1 text-gold/90 hover:text-gold">
                <Mail className="size-3" />
                {ticket.email}
              </a>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Категория</dt>
            <dd className="text-foreground">{CATEGORY_RU[ticket.category]}</dd>
          </div>
          {ticket.orderNumber && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Заказ</dt>
              <dd className="font-mono text-foreground">{ticket.orderNumber}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Создано</dt>
            <dd className="text-foreground">{when(ticket.createdAt)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="admin-ticket-status" className="text-xs text-muted-foreground">
            Статус
          </label>
          <select
            id="admin-ticket-status"
            value={ticket.status}
            onChange={(e) => onStatus(e.target.value as SupportTicketStatus)}
            className={INPUT}
          >
            {SUPPORT_TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_RU[s]}
              </option>
            ))}
          </select>
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      <ol className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
        {ticket.messages.map((m) => {
          const staff = m.author === 'staff'
          return (
            <li
              key={m.id}
              className={cn(
                'rounded-xl border p-4',
                staff ? 'ml-6 border-gold/20 bg-gold/5' : 'mr-6 border-border bg-background/40',
              )}
            >
              <p className="flex items-center justify-between gap-2 text-[11px]">
                <span className={staff ? 'font-medium text-gold' : 'font-medium text-foreground'}>
                  {staff ? 'Поддержка' : `Клиент · ${ticket.name}`}
                </span>
                <span className="text-muted-foreground">{when(m.createdAt)}</span>
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{m.body}</p>
              <Attachments items={m.attachments} />
            </li>
          )
        })}
      </ol>

      <form onSubmit={send} className="border-t border-border p-5">
        <label htmlFor="admin-support-reply" className="mb-2 block text-xs text-muted-foreground">
          Ответ клиенту — придёт на {ticket.email} и появится в его обращении
        </label>
        <textarea
          id="admin-support-reply"
          rows={5}
          maxLength={5000}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          className={cn(INPUT, 'w-full resize-y leading-relaxed')}
        />
        {files.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1 text-xs">
                <span className="max-w-[10rem] truncate">{f.name}</span>
                <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  aria-label={`Убрать ${f.name}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label
            htmlFor="admin-support-files"
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition hover:text-gold"
          >
            <Paperclip className="size-3.5" />
            Вложение
          </label>
          <input
            id="admin-support-files"
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(',')}
            className="sr-only"
            onChange={(e) => {
              void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <label htmlFor="admin-reply-status" className="ml-auto text-xs text-muted-foreground">
            Статус после ответа
          </label>
          <select
            id="admin-reply-status"
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value as SupportTicketStatus)}
            className={INPUT}
          >
            {SUPPORT_TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_RU[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={sending || !reply.trim()}
            className="flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Ответить
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </form>
    </div>
  )
}
