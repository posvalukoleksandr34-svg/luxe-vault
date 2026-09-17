'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, ImagePlus, Loader2, Mail, Monitor, Search, Send, Smartphone, Users, X } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import {
  CAMPAIGN_LIMITS,
  renderCampaignEmail,
  validateCampaign,
  type CampaignContent,
  type CampaignFieldError,
} from '@/lib/newsletter/campaign'
import { CTA_LINK_PRESETS, CTA_TEXT_PRESETS, isPresetPath } from '@/lib/newsletter/cta-links'
import { getSiteUrl } from '@/lib/site-url'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

type SubscriberStatus = 'active' | 'unsubscribed'
type Subscriber = {
  id: string
  email: string
  status: SubscriberStatus
  locale: string
  source: string
  createdAt: string
}
type Campaign = {
  id: string
  createdAt: string
  subject: string
  status: 'sending' | 'sent' | 'partial' | 'failed'
  mode: 'live' | 'test'
  recipients: number
  sent: number
  failed: number
}
type Loaded = {
  total: number
  active: number
  rows: Subscriber[]
  campaigns: Campaign[]
  mode: 'live' | 'test'
}

type SendState =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'sending'; sent: number; failed: number; total: number }
  | { kind: 'done'; sent: number; failed: number; total: number; mode: 'live' | 'test'; error?: string }
  | { kind: 'error'; message: string }

const EMPTY: CampaignContent = {
  subject: '',
  preheader: '',
  title: '',
  body: '',
  imageUrl: '',
  ctaLabel: '',
  ctaUrl: '',
}

const DRAFT_KEY = 'lv.admin.newsletter-draft.v1'
const PAGE = 100

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-gold aria-[invalid=true]:border-destructive/70'

function newKey(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // Non-secure origins lack randomUUID; this only needs to be unique.
    const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  }
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * /admin/newsletter — subscribers and campaigns.
 *
 * The composer's preview is the real template (lib/newsletter/campaign.ts)
 * rendered into a sandboxed iframe, so what is previewed is what is sent. A
 * send needs an explicit confirmation naming the number of recipients, then
 * streams its progress back from /api/admin/send-campaign.
 *
 * The draft is kept in this browser's storage, so a reload or a closed tab
 * does not lose an hour of writing.
 */
export function NewsletterManager() {
  const { pushToast } = useStore()

  const [data, setData] = useState<Loaded | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'gap-tables' | 'gap-columns' | 'error'>('loading')

  const [draft, setDraft] = useState<CampaignContent>(EMPTY)
  const [touched, setTouched] = useState(false)
  const [clientKey, setClientKey] = useState<string>('')
  const [send, setSend] = useState<SendState>({ kind: 'idle' })
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop')

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | SubscriberStatus>('all')
  const [visible, setVisible] = useState(PAGE)
  const [pending, setPending] = useState<Set<string>>(new Set())

  const draftLoaded = useRef(false)

  const load = useCallback(async () => {
    setLoadState('loading')
    try {
      const res = await fetch('/api/admin/newsletter/subscribers', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (res.status === 503 && body?.gap) {
        setLoadState(body.gap === 'columns' ? 'gap-columns' : 'gap-tables')
        return
      }
      if (!res.ok || !body) {
        setLoadState('error')
        return
      }
      setData(body as Loaded)
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void load()
    setClientKey(newKey())
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) setDraft({ ...EMPTY, ...(JSON.parse(saved) as Partial<CampaignContent>) })
    } catch {
      // No storage: start empty.
    }
    draftLoaded.current = true
  }, [load])

  useEffect(() => {
    if (!draftLoaded.current) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // Storage full or blocked: the draft simply is not kept.
    }
  }, [draft])

  const { content, errors } = useMemo(() => validateCampaign(draft), [draft])
  const hasErrors = Object.keys(errors).length > 0
  const shownErrors: CampaignFieldError = touched ? errors : {}

  const previewHtml = useMemo(() => {
    const site = getSiteUrl()
    // Placeholders keep the layout readable while fields are empty; they are
    // never sent (the send validates the real fields).
    const sample: CampaignContent = {
      ...content,
      subject: content.subject || 'Тема письма',
      title: content.title || 'Заголовок письма',
      body: content.body || 'Здесь появится основной текст письма.\n\nПустая строка начинает новый абзац.',
    }
    return renderCampaignEmail(sample, { siteUrl: site, unsubscribeUrl: `${site}/newsletter/unsubscribe` }).html
  }, [content])

  function update<K extends keyof CampaignContent>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function requestSend() {
    setTouched(true)
    if (hasErrors) {
      pushToast({ title: 'Проверьте поля письма', variant: 'default' })
      return
    }
    if (!data || data.active === 0) {
      pushToast({ title: 'Нет активных подписчиков', variant: 'default' })
      return
    }
    setSend({ kind: 'confirm' })
  }

  async function confirmSend() {
    if (!data) return
    setSend({ kind: 'sending', sent: 0, failed: 0, total: data.active })
    try {
      const res = await fetch('/api/admin/send-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...content, clientKey, expectedRecipients: data.active }),
      })

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null)
        const message =
          body?.error === 'ALREADY_SENT'
            ? 'Это письмо уже отправлено. Чтобы отправить его снова, откройте подтверждение ещё раз.'
            : body?.error === 'RECIPIENTS_CHANGED'
              ? `Число подписчиков изменилось (сейчас ${body.total}). Обновите список и подтвердите снова.`
              : body?.error === 'NO_RECIPIENTS'
                ? 'Нет активных подписчиков.'
                : 'Не удалось начать рассылку.'
        if (body?.error === 'ALREADY_SENT') setClientKey(newKey())
        if (body?.error === 'RECIPIENTS_CHANGED') void load()
        setSend({ kind: 'error', message })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          const event = JSON.parse(line) as {
            type: string
            sent?: number
            failed?: number
            total?: number
            mode?: 'live' | 'test'
            error?: string
          }
          if (event.type === 'start' || event.type === 'progress') {
            setSend({ kind: 'sending', sent: event.sent ?? 0, failed: event.failed ?? 0, total: event.total ?? data.active })
          } else if (event.type === 'done') {
            finished = true
            const result = {
              sent: event.sent ?? 0,
              failed: event.failed ?? 0,
              total: event.total ?? data.active,
              mode: event.mode ?? 'live',
              error: event.error,
            }
            setSend({ kind: 'done', ...result })
            pushToast({
              title:
                result.mode === 'test'
                  ? `Тестовый режим: письмо подготовлено для ${result.total} подписчиков, но не отправлено им`
                  : result.failed === 0
                    ? `Рассылка отправлена: ${result.sent} подписчикам`
                    : `Отправлено ${result.sent} из ${result.total}, не доставлено: ${result.failed}`,
              variant: result.failed === 0 ? 'success' : 'default',
            })
          }
        }
      }
      // A new key: sending this draft again is a deliberate, separate campaign.
      setClientKey(newKey())
      void load()
      if (!finished) setSend({ kind: 'error', message: 'Соединение прервалось. Проверьте историю рассылок ниже.' })
    } catch {
      setClientKey(newKey())
      void load()
      setSend({ kind: 'error', message: 'Соединение прервалось. Проверьте историю рассылок ниже, прежде чем отправлять снова.' })
    }
  }

  async function toggleSubscriber(row: Subscriber, next: SubscriberStatus) {
    if (!data) return
    setPending((p) => new Set(p).add(row.id))
    const previous = data
    setData({
      ...data,
      active: data.active + (next === 'active' ? 1 : -1),
      rows: data.rows.map((r) => (r.id === row.id ? { ...r, status: next } : r)),
    })
    try {
      const res = await fetch('/api/admin/newsletter/subscribers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, status: next }),
      })
      if (!res.ok) throw new Error()
      pushToast({ title: next === 'active' ? `${row.email} — подписка включена` : `${row.email} — отписан`, variant: 'success' })
    } catch {
      setData(previous)
      pushToast({ title: 'Не удалось изменить подписку', variant: 'default' })
    } finally {
      setPending((p) => {
        const n = new Set(p)
        n.delete(row.id)
        return n
      })
    }
  }

  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.rows.filter((r) => (filter === 'all' || r.status === filter) && (!q || r.email.includes(q)))
  }, [data, query, filter])

  const sending = send.kind === 'sending'

  return (
    <main id="main" className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-[1280px]">
        <Link
          href="/admin"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Назад в админ-панель
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gold/10">
            <Mail className="size-5 text-gold" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold text-foreground">Рассылка</h1>
            <p className="text-xs text-muted-foreground">Подписчики, письма и отправка кампаний.</p>
          </div>
        </div>

        {loadState === 'gap-tables' && (
          <Notice>
            В Supabase ещё нет таблицы <code className="text-foreground">newsletter_subscribers</code>. Примените
            миграции <code className="text-foreground">0034_newsletter_subscribers.sql</code> и{' '}
            <code className="text-foreground">0037_newsletter_campaigns.sql</code>.
          </Notice>
        )}
        {loadState === 'gap-columns' && (
          <Notice>
            Таблица подписчиков есть, но миграция <code className="text-foreground">0037_newsletter_campaigns.sql</code>{' '}
            ещё не применена — без неё нельзя отправлять рассылки и менять статусы.
          </Notice>
        )}
        {loadState === 'error' && (
          <Notice>
            Не удалось загрузить подписчиков.{' '}
            <button type="button" onClick={() => void load()} className="text-gold underline underline-offset-2">
              Повторить
            </button>
          </Notice>
        )}
        {data?.mode === 'test' && (
          <Notice>
            Почта работает в <strong className="text-foreground">тестовом режиме</strong> (EMAIL_DELIVERY=test или не
            задан RESEND_API_KEY): рассылка будет подготовлена, но подписчики её не получат.
          </Notice>
        )}

        {/* Analytics */}
        <section className="mb-8 grid gap-4 sm:grid-cols-3">
          <StatCard label="Активные подписчики" value={data ? String(data.active) : '—'} accent loading={loadState === 'loading'} />
          <StatCard label="Всего адресов" value={data ? String(data.total) : '—'} loading={loadState === 'loading'} />
          <StatCard label="Отписались" value={data ? String(data.total - data.active) : '—'} loading={loadState === 'loading'} />
        </section>

        {/* Composer + preview */}
        <section className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              requestSend()
            }}
            noValidate
            className="space-y-5 rounded-2xl border border-border bg-card p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-serif text-lg font-semibold text-foreground">Новое письмо</h2>
              <button
                type="button"
                onClick={() => {
                  setDraft(EMPTY)
                  setTouched(false)
                }}
                className="text-xs text-muted-foreground transition hover:text-foreground"
              >
                Очистить
              </button>
            </div>

            <Field id="nl-subject" label="Тема письма" error={shownErrors.subject} count={[draft.subject.length, CAMPAIGN_LIMITS.subject]}>
              <input id="nl-subject" value={draft.subject} onChange={(e) => update('subject', e.target.value)} aria-invalid={Boolean(shownErrors.subject)} className={INPUT} placeholder="Новая коллекция уже в Vault" />
            </Field>
            <Field id="nl-preheader" label="Текст предпросмотра" hint="Серая строка рядом с темой во входящих" error={shownErrors.preheader} count={[draft.preheader.length, CAMPAIGN_LIMITS.preheader]}>
              <input id="nl-preheader" value={draft.preheader} onChange={(e) => update('preheader', e.target.value)} aria-invalid={Boolean(shownErrors.preheader)} className={INPUT} placeholder="Лимитированные модели — только для подписчиков" />
            </Field>

            <div className="border-t border-border pt-5" />

            <Field id="nl-title" label="Заголовок" error={shownErrors.title}>
              <input id="nl-title" value={draft.title} onChange={(e) => update('title', e.target.value)} aria-invalid={Boolean(shownErrors.title)} className={INPUT} />
            </Field>
            <Field id="nl-body" label="Основной текст" hint="Пустая строка — новый абзац. Только текст, без HTML." error={shownErrors.body} count={[draft.body.length, CAMPAIGN_LIMITS.body]}>
              <textarea id="nl-body" rows={8} value={draft.body} onChange={(e) => update('body', e.target.value)} aria-invalid={Boolean(shownErrors.body)} className={cn(INPUT, 'resize-y leading-relaxed')} />
            </Field>
            <ImageUpload
              value={draft.imageUrl}
              onChange={(url) => update('imageUrl', url)}
              error={shownErrors.imageUrl}
            />

            <CtaFields
              label={draft.ctaLabel}
              url={draft.ctaUrl}
              onLabel={(v) => update('ctaLabel', v)}
              onUrl={(v) => update('ctaUrl', v)}
              errors={shownErrors}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <p className="text-xs text-muted-foreground">
                Получат: <span className="tabular-nums text-foreground">{data ? data.active : '—'}</span> активных подписчиков
              </p>
              <button
                type="submit"
                disabled={sending || loadState !== 'ready'}
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-sm font-medium text-gold-foreground transition hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="size-4" />
                Отправить рассылку
              </button>
            </div>
          </form>

          <div className="flex flex-col rounded-2xl border border-border bg-card lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Предпросмотр</p>
              <div className="flex items-center gap-1" role="group" aria-label="Ширина предпросмотра">
                {(['desktop', 'mobile'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setPreviewWidth(w)}
                    aria-pressed={previewWidth === w}
                    aria-label={w === 'desktop' ? 'Компьютер' : 'Телефон'}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md transition',
                      previewWidth === w ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {w === 'desktop' ? <Monitor className="size-4" /> : <Smartphone className="size-4" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-5 pt-3">
              <p className="truncate text-sm text-foreground">{content.subject || 'Тема письма'}</p>
              <p className="truncate text-xs text-muted-foreground">{content.preheader || content.title || 'Текст предпросмотра'}</p>
            </div>
            <div className="flex min-h-0 flex-1 justify-center overflow-auto p-5">
              <iframe
                title="Предпросмотр письма"
                sandbox=""
                srcDoc={previewHtml}
                className={cn(
                  'h-[640px] rounded-lg border border-border bg-black transition-[width] duration-300 lg:h-[calc(100vh-15rem)]',
                  previewWidth === 'desktop' ? 'w-full' : 'w-[375px] max-w-full',
                )}
              />
            </div>
          </div>
        </section>

        {/* Campaign history */}
        {data && data.campaigns.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 font-serif text-lg font-semibold text-foreground">История рассылок</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[40rem] text-left text-[13px]">
                <thead className="bg-background/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-normal">Тема</th>
                    <th className="px-4 py-3 font-normal">Дата</th>
                    <th className="px-4 py-3 font-normal">Статус</th>
                    <th className="px-4 py-3 text-right font-normal">Отправлено</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="max-w-[22rem] truncate px-4 py-3 text-foreground">{c.subject}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dateFmt.format(new Date(c.createdAt))}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.mode === 'test' ? 'Тест · ' : ''}
                        {{ sending: 'Отправляется', sent: 'Отправлено', partial: 'Частично', failed: 'Ошибка' }[c.status]}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {c.sent} / {c.recipients}
                        {c.failed > 0 && <span className="text-destructive"> · {c.failed} ошибок</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Subscribers */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-lg font-semibold text-foreground">Подписчики</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Фильтр">
                {([
                  ['all', 'Все'],
                  ['active', 'Активные'],
                  ['unsubscribed', 'Отписались'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setFilter(key)
                      setVisible(PAGE)
                    }}
                    aria-pressed={filter === key}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs transition',
                      filter === key ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setVisible(PAGE)
                  }}
                  placeholder="Поиск по email"
                  aria-label="Поиск подписчиков"
                  className="w-56 rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground outline-none focus:border-gold"
                />
              </div>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Включайте подписку снова только с согласия человека — например, если он попросил об этом сам.
          </p>

          {loadState === 'loading' ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-gold" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Users className="size-6 text-muted-foreground/25" strokeWidth={1.25} />
              <p className="text-[13px] text-muted-foreground">
                {data && data.rows.length > 0 ? 'Ничего не найдено' : 'Подписчиков пока нет'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[40rem] text-left text-[13px]">
                  <thead className="bg-background/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-normal">Email</th>
                      <th className="px-4 py-3 font-normal">Дата подписки</th>
                      <th className="px-4 py-3 font-normal">Источник</th>
                      <th className="px-4 py-3 text-right font-normal">Подписка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, visible).map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-4 py-3 text-foreground">{r.email}</td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">{dateFmt.format(new Date(r.createdAt))}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {r.source || '—'} · {r.locale.toUpperCase()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2.5">
                            <span className={cn('text-xs', r.status === 'active' ? 'text-gold' : 'text-muted-foreground')}>
                              {r.status === 'active' ? 'Активна' : 'Отписан'}
                            </span>
                            <Switch
                              checked={r.status === 'active'}
                              disabled={pending.has(r.id) || loadState !== 'ready'}
                              onCheckedChange={(on) => void toggleSubscriber(r, on ? 'active' : 'unsubscribed')}
                              aria-label={`Подписка ${r.email}`}
                              className="data-[state=checked]:bg-gold data-[state=unchecked]:bg-muted"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visible < filtered.length && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisible((v) => v + PAGE)}
                    className="rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground transition hover:text-foreground"
                  >
                    Показать ещё · {filtered.length - visible}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Dialog.Root
        open={send.kind !== 'idle'}
        onOpenChange={(open) => {
          // Cannot be dismissed while the batches are going out.
          if (!open && send.kind !== 'sending') setSend({ kind: 'idle' })
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[121] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl outline-none"
            onEscapeKeyDown={(e) => {
              if (send.kind === 'sending') e.preventDefault()
            }}
            onPointerDownOutside={(e) => {
              if (send.kind === 'sending') e.preventDefault()
            }}
          >
            {send.kind !== 'sending' && (
              <Dialog.Close aria-label="Закрыть" className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </Dialog.Close>
            )}

            {send.kind === 'confirm' && data && (
              <>
                <Dialog.Title className="pr-8 font-serif text-lg font-semibold text-foreground">
                  Отправить письмо {data.active} {plural(data.active)}?
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  «{content.subject}». Отменить отправку после начала нельзя.
                  {data.mode === 'test' && ' Сейчас тестовый режим: подписчики письмо не получат.'}
                </Dialog.Description>
                <div className="mt-6 flex justify-end gap-2">
                  <button type="button" onClick={() => setSend({ kind: 'idle' })} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground">
                    Отмена
                  </button>
                  <button type="button" onClick={() => void confirmSend()} className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-gold-foreground transition hover:bg-gold/90">
                    <Send className="size-4" />
                    Отправить
                  </button>
                </div>
              </>
            )}

            {send.kind === 'sending' && (
              <>
                <Dialog.Title className="font-serif text-lg font-semibold text-foreground">Идёт отправка…</Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground" aria-live="polite">
                  Отправлено {send.sent} из {send.total}
                  {send.failed > 0 && `, ошибок: ${send.failed}`}. Не закрывайте страницу.
                </Dialog.Description>
                <Progress value={send.sent + send.failed} total={send.total} />
              </>
            )}

            {send.kind === 'done' && (
              <>
                <Dialog.Title className="pr-8 font-serif text-lg font-semibold text-foreground">
                  {send.mode === 'test' ? 'Тестовая отправка завершена' : send.failed === 0 ? 'Рассылка отправлена' : 'Рассылка отправлена частично'}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {send.mode === 'test'
                    ? `Письмо подготовлено для ${send.total} ${plural(send.total)}, но в тестовом режиме им не отправлено.`
                    : `Успешно: ${send.sent} из ${send.total}.${send.failed > 0 ? ` Не доставлено: ${send.failed}.` : ''}`}
                  {send.error && <span className="mt-2 block text-xs text-destructive">{send.error}</span>}
                </Dialog.Description>
                <Progress value={send.sent + send.failed} total={send.total} />
                <div className="mt-6 flex justify-end">
                  <button type="button" onClick={() => setSend({ kind: 'idle' })} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition hover:border-gold/50">
                    Готово
                  </button>
                </div>
              </>
            )}

            {send.kind === 'error' && (
              <>
                <Dialog.Title className="pr-8 font-serif text-lg font-semibold text-foreground">Рассылка не отправлена</Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">{send.message}</Dialog.Description>
                <div className="mt-6 flex justify-end">
                  <button type="button" onClick={() => setSend({ kind: 'idle' })} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground">
                    Закрыть
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  )
}

function plural(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'подписчику'
  return 'подписчикам'
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mb-6 rounded-xl border border-gold/30 p-4 text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function StatCard({ label, value, accent, loading }: { label: string; value: string; accent?: boolean; loading?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {loading ? (
        <Loader2 className="mt-3 size-5 animate-spin text-muted-foreground/50" />
      ) : (
        <p className={cn('mt-2 font-serif text-3xl tabular-nums', accent ? 'text-gold' : 'text-foreground')}>{value}</p>
      )}
    </div>
  )
}

function Progress({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="h-full bg-gold transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Field({
  id,
  label,
  hint,
  error,
  count,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  count?: [number, number]
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        {count && (
          <span className={cn('text-[11px] tabular-nums', count[0] > count[1] ? 'text-destructive' : 'text-muted-foreground/60')}>
            {count[0]}/{count[1]}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">{hint}</p>
      ) : null}
    </div>
  )
}

/** Mirrors the bucket (migration 0038): JPEG, PNG, GIF — what every mail
 *  client displays — up to 5 MB. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * The campaign image: drop a file or pick one, and it is uploaded straight to
 * Supabase Storage (`newsletter-images`) through /api/admin/newsletter/image.
 * The returned public URL is what the email uses.
 */
function ImageUpload({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (url: string) => void
  error?: string
}) {
  const { pushToast } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function upload(file: File | undefined) {
    if (!file || uploading) return
    setProblem(null)
    if (IMAGE_TYPES.indexOf(file.type) === -1) {
      setProblem('Для писем подходят только JPEG, PNG или GIF.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setProblem(`Файл весит ${(file.size / 1024 / 1024).toFixed(1)} МБ, максимум — 5 МБ.`)
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file, file.name)
      const res = await fetch('/api/admin/newsletter/image', { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok || typeof data?.url !== 'string') {
        setProblem(typeof data?.error === 'string' ? data.error : 'Не удалось загрузить изображение.')
        return
      }
      onChange(data.url)
      pushToast({ title: 'Изображение загружено', variant: 'success' })
    } catch {
      setProblem('Не удалось загрузить изображение. Проверьте соединение.')
    } finally {
      setUploading(false)
    }
  }

  const message = problem ?? error

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span id="nl-image-label" className="text-xs text-muted-foreground">
          Изображение
        </span>
        {value && !uploading && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[11px] text-muted-foreground transition hover:text-destructive"
          >
            Удалить
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void upload(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <button
        type="button"
        aria-labelledby="nl-image-label"
        aria-describedby={message ? undefined : 'nl-image-hint'}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void upload(e.dataTransfer.files?.[0])
        }}
        className={cn(
          'relative flex w-full items-center justify-center overflow-hidden rounded-lg border border-dashed text-left transition',
          value ? 'min-h-[160px]' : 'min-h-[132px]',
          dragging ? 'border-gold bg-gold/5' : 'border-border hover:border-gold/50',
          message && !dragging && 'border-destructive/70',
        )}
      >
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="max-h-[220px] w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-background/85 px-3 py-2 text-center text-xs text-foreground">
              {uploading ? 'Загружаем…' : 'Перетащите другое изображение или нажмите, чтобы заменить'}
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            {uploading ? (
              <Loader2 className="size-5 animate-spin text-gold" />
            ) : (
              <ImagePlus className="size-5 text-muted-foreground" strokeWidth={1.5} />
            )}
            <span className="text-sm text-foreground">
              {uploading ? 'Загружаем…' : dragging ? 'Отпустите, чтобы загрузить' : 'Перетащите изображение или выберите файл'}
            </span>
          </span>
        )}
        {uploading && value && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="size-5 animate-spin text-gold" />
          </span>
        )}
      </button>

      {message ? (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {message}
        </p>
      ) : (
        <p id="nl-image-hint" className="mt-1.5 text-[11px] text-muted-foreground/70">
          Необязательно. JPEG, PNG или GIF до 5 МБ, ширина от 1160px.
        </p>
      )}
    </div>
  )
}

const CUSTOM = '__custom__'

/**
 * The button: preset labels as chips over the text field, and a link chosen
 * from the shop's stable addresses (lib/newsletter/cta-links.ts) or typed in.
 */
function CtaFields({
  label,
  url,
  onLabel,
  onUrl,
  errors,
}: {
  label: string
  url: string
  onLabel: (value: string) => void
  onUrl: (value: string) => void
  errors: CampaignFieldError
}) {
  const [customMode, setCustomMode] = useState(false)
  const selected = customMode || (url && !isPresetPath(url)) ? CUSTOM : url

  return (
    <div className="space-y-5 rounded-xl border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Кнопка</p>
        {(label || url || customMode) && (
          <button
            type="button"
            onClick={() => {
              onLabel('')
              onUrl('')
              setCustomMode(false)
            }}
            className="text-[11px] text-muted-foreground transition hover:text-destructive"
          >
            Без кнопки
          </button>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Готовые подписи кнопки">
          {CTA_TEXT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onLabel(preset)}
              aria-pressed={label === preset}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition',
                label === preset
                  ? 'border-gold bg-gold/10 text-gold'
                  : 'border-border text-muted-foreground hover:border-gold/50 hover:text-foreground',
              )}
            >
              {preset}
            </button>
          ))}
        </div>
        <Field id="nl-cta-label" label="Текст кнопки" error={errors.ctaLabel}>
          <input
            id="nl-cta-label"
            value={label}
            onChange={(e) => onLabel(e.target.value)}
            aria-invalid={Boolean(errors.ctaLabel)}
            className={INPUT}
            placeholder="Или напишите свой текст"
          />
        </Field>
      </div>

      <Field id="nl-cta-url" label="Ссылка кнопки" error={selected === CUSTOM ? undefined : errors.ctaUrl}>
        <select
          id="nl-cta-url"
          value={selected}
          onChange={(e) => {
            const next = e.target.value
            if (next === CUSTOM) {
              setCustomMode(true)
              if (isPresetPath(url)) onUrl('')
            } else {
              setCustomMode(false)
              onUrl(next)
            }
          }}
          aria-invalid={Boolean(errors.ctaUrl) && selected !== CUSTOM}
          className={cn(INPUT, 'cursor-pointer')}
        >
          <option value="">— Выберите страницу —</option>
          {CTA_LINK_PRESETS.map((preset) => (
            <option key={preset.path} value={preset.path}>
              {preset.label} · {preset.path}
            </option>
          ))}
          <option value={CUSTOM}>Своя ссылка…</option>
        </select>
      </Field>

      {selected === CUSTOM && (
        <Field
          id="nl-cta-custom"
          label="Своя ссылка"
          hint="https://… или путь на сайте, например /category/clothing"
          error={errors.ctaUrl}
        >
          <input
            id="nl-cta-custom"
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            aria-invalid={Boolean(errors.ctaUrl)}
            className={INPUT}
            placeholder="https://"
          />
        </Field>
      )}
    </div>
  )
}
