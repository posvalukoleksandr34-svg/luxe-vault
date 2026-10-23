'use client'

import { ArrowLeft, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, Field, Spinner, api, inputClass, useMe } from '@/components/admin/refunds/shared'
import { StaffBar } from '@/components/admin/refunds/staff-bar'
import {
  CONSENT_MODES,
  REASON_LABEL_RU,
  REVIEW_REQUEST_STATUSES,
  STATUS_LABEL_RU,
  type ConsentMode,
  type ReviewRequestSettings,
  type ReviewRequestStatus,
  type SuppressReason,
} from '@/lib/review-requests'

/**
 * /admin/review-requests — post-delivery review requests: the switch and the
 * settings, the figures, the queue, and the few things staff may do to one
 * request. Every action is checked again on the server (review_requests.*
 * permissions); what this page hides is a courtesy, not the control.
 *
 * Times are stored in UTC and shown here in the browser's own time zone.
 */

type Row = {
  id: string
  orderNumber: string
  customerName: string
  customerEmail: string
  status: ReviewRequestStatus
  reason: string | null
  deliveredAt: string
  scheduledAt: string
  nextAttemptAt: string | null
  sentAt: string | null
  attempts: number
  lastError: string | null
  reviewsSubmitted: number
  products: string[]
}

type Metrics = {
  byStatus: Record<ReviewRequestStatus, number>
  sent30d: number
  withReview: number
  reviewsSubmitted: number
  conversion: number | null
}

type Payload = {
  rows: Row[]
  total: number
  page: number
  pageSize: number
  metrics: Metrics
  settings: ReviewRequestSettings
  settingsSource: 'database' | 'defaults'
  defaults: ReviewRequestSettings
  mail: { configured: boolean; mode: 'live' | 'test' }
  testRecipients: string[]
}

const TONE: Record<ReviewRequestStatus, 'muted' | 'gold' | 'green' | 'red' | 'amber' | 'blue'> = {
  scheduled: 'blue',
  sending: 'amber',
  sent: 'green',
  failed: 'red',
  cancelled: 'muted',
  suppressed: 'muted',
}

const CONSENT_RU: Record<ConsentMode, string> = {
  marketing_consent: 'Только подписчикам рассылки (подтверждённое согласие)',
  existing_customer: 'Всем покупателям, кто не отказался (уведомление при оформлении заказа)',
}

const LANGS = [
  ['en', 'English'],
  ['ru', 'Русский'],
  ['it', 'Italiano'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
] as const

const TZ = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : ''

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

function reasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return REASON_LABEL_RU[reason as SuppressReason] ?? reason
}

export function ReviewRequestsConsole() {
  const router = useRouter()
  const params = useSearchParams()
  const { me, error: meError, reload, can } = useMe()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [q, setQ] = useState(params.get('q') ?? '')
  const [product, setProduct] = useState(params.get('product') ?? '')

  const query = params.toString()
  const ready = me && me.mode !== 'unbound'

  const load = useCallback(() => {
    if (!ready) return
    setLoading(true)
    setError(null)
    api<Payload>(`/api/admin/review-requests?${query}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [query, ready])
  useEffect(() => load(), [load])

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    router.push(`/admin/review-requests?${next.toString()}`)
  }

  async function act(id: string, action: 'retry' | 'cancel') {
    if (action === 'cancel' && !window.confirm('Отменить этот запрос? Письмо по этому заказу не уйдёт.')) return
    setBusyId(id)
    setNotice(null)
    try {
      await api(`/api/admin/review-requests/${encodeURIComponent(id)}`, { method: 'POST', json: { action } })
      setNotice(action === 'retry' ? 'Запрос возвращён в очередь — уйдёт при следующем запуске, если всё ещё допустим.' : 'Запрос отменён.')
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const page = data?.page ?? 1
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const selected = params.get('status') ?? ''

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Панель управления
      </Link>
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Запросы отзывов</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Письмо «Как вам покупка?» уходит через заданное время после подтверждённой доставки — каждому покупателю, а не
          только довольным. Отменённые, полностью возвращённые и помеченные как мошеннические заказы не получают письма.
        </p>
      </div>

      {meError && <p className="text-sm text-red-700">{meError}</p>}
      {me && <StaffBar me={me} onChange={reload} />}

      {ready && (
        <>
          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-sm text-foreground">
              {notice}
            </p>
          )}

          {!data && loading && <Spinner />}

          {data && (
            <>
              <StatusBanner data={data} />
              <MetricsCards metrics={data.metrics} onFilter={(s) => setParam('status', s)} />
              <SettingsForm
                key={JSON.stringify(data.settings)}
                initial={data.settings}
                defaults={data.defaults}
                editable={can('review_requests.settings')}
                onSaved={() => {
                  setNotice('Настройки сохранены.')
                  load()
                }}
              />
            </>
          )}

          <section aria-label="Фильтры" className="flex flex-wrap items-end gap-3">
            <select aria-label="Статус" value={selected} onChange={(e) => setParam('status', e.target.value || null)} className={`${inputClass} w-auto`}>
              <option value="">Все статусы</option>
              {REVIEW_REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL_RU[s]}
                </option>
              ))}
            </select>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const next = new URLSearchParams(params.toString())
                for (const [k, v] of [
                  ['q', q.trim()],
                  ['product', product.trim()],
                ] as const) {
                  if (v) next.set(k, v)
                  else next.delete(k)
                }
                next.delete('page')
                router.push(`/admin/review-requests?${next.toString()}`)
              }}
              className="flex flex-wrap gap-2"
            >
              <input aria-label="Заказ или покупатель" value={q} onChange={(e) => setQ(e.target.value)} placeholder="LV-…, email, имя" className={`${inputClass} w-48`} />
              <input aria-label="Товар" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Товар" className={`${inputClass} w-40`} />
              <Button type="submit">Найти</Button>
            </form>
            <label className="text-xs text-muted-foreground">
              Запланирован с
              <input type="date" value={params.get('from') ?? ''} onChange={(e) => setParam('from', e.target.value || null)} className={`${inputClass} mt-1 w-auto`} />
            </label>
            <label className="text-xs text-muted-foreground">
              по
              <input type="date" value={params.get('to') ?? ''} onChange={(e) => setParam('to', e.target.value || null)} className={`${inputClass} mt-1 w-auto`} />
            </label>
            <div className="ml-auto">
              <Button onClick={load} busy={loading}>
                <RefreshCw className="size-4" /> Обновить
              </Button>
            </div>
          </section>

          {data && (
            <section aria-label="Запросы" className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Заказ / покупатель</th>
                    <th className="px-3 py-2 font-medium">Товары</th>
                    <th className="px-3 py-2 font-medium">Статус</th>
                    <th className="px-3 py-2 font-medium">Доставлен</th>
                    <th className="px-3 py-2 font-medium">Запланирован / след. попытка</th>
                    <th className="px-3 py-2 font-medium">Отправлен</th>
                    <th className="px-3 py-2 font-medium">Попытки</th>
                    <th className="px-3 py-2 font-medium">Отзывы</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                        Нет запросов под этот фильтр.
                      </td>
                    </tr>
                  )}
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <Link href={`/admin/orders?order=${encodeURIComponent(r.orderNumber)}`} className="font-mono text-xs text-foreground hover:underline">
                          {r.orderNumber}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{r.customerName || '—'}</span>
                        <span className="block break-all text-[11px] text-muted-foreground/80">{r.customerEmail}</span>
                      </td>
                      <td className="max-w-[200px] px-3 py-2 text-xs text-muted-foreground">{r.products.join(', ') || '—'}</td>
                      <td className="px-3 py-2">
                        <Badge tone={TONE[r.status]}>{STATUS_LABEL_RU[r.status]}</Badge>
                        {reasonLabel(r.reason) && <span className="mt-1 block text-[11px] text-muted-foreground">{reasonLabel(r.reason)}</span>}
                        {r.lastError && (
                          <span className="mt-1 block max-w-[220px] break-words text-[11px] text-red-700" title={r.lastError}>
                            {r.lastError.slice(0, 140)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">{when(r.deliveredAt)}</td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {when(r.scheduledAt)}
                        {r.nextAttemptAt && r.nextAttemptAt !== r.scheduledAt && r.status === 'scheduled' && (
                          <span className="block text-muted-foreground">→ {when(r.nextAttemptAt)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">{when(r.sentAt)}</td>
                      <td className="px-3 py-2 text-xs tabular-nums">{r.attempts}</td>
                      <td className="px-3 py-2 text-xs tabular-nums">{r.reviewsSubmitted}</td>
                      <td className="px-3 py-2">
                        {can('review_requests.manage') && (
                          <div className="flex flex-col gap-1">
                            {(r.status === 'failed' || r.status === 'cancelled') && (
                              <Button onClick={() => act(r.id, 'retry')} busy={busyId === r.id}>
                                Повторить
                              </Button>
                            )}
                            {(r.status === 'scheduled' || r.status === 'failed') && (
                              <Button tone="danger" onClick={() => act(r.id, 'cancel')} busy={busyId === r.id}>
                                Отменить
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {data && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Всего: {data.total} · время — {TZ || 'местное'}
              </span>
              <div className="flex gap-2">
                <Button disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                  Назад
                </Button>
                <span className="self-center tabular-nums">
                  {page} / {pages}
                </span>
                <Button disabled={page >= pages} onClick={() => setParam('page', String(page + 1))}>
                  Вперёд
                </Button>
              </div>
            </div>
          )}

          {data && <PreviewAndTest recipients={data.testRecipients} canSend={can('review_requests.manage')} mail={data.mail} />}
        </>
      )}
    </div>
  )
}

function StatusBanner({ data }: { data: Payload }) {
  const { settings, mail } = data
  const lines: { tone: 'ok' | 'warn'; text: string }[] = []
  lines.push(
    settings.enabled
      ? { tone: 'ok', text: `Отправка включена: письмо через ${settings.delayHours} ч после доставки.` }
      : { tone: 'warn', text: 'Отправка выключена. Запросы создаются и ждут; письма не уходят, пока вы её не включите.' },
  )
  if (!mail.configured) lines.push({ tone: 'warn', text: 'Почта не настроена (нет RESEND_API_KEY) — письма не уйдут.' })
  else if (mail.mode === 'test') lines.push({ tone: 'warn', text: 'EMAIL_DELIVERY=test: письма только записываются в лог, покупателям ничего не уходит.' })
  if (data.settingsSource === 'defaults') lines.push({ tone: 'warn', text: 'Настройки ещё не сохранялись — действуют значения по умолчанию.' })
  return (
    <section aria-label="Состояние" className="space-y-1 rounded-lg border border-border p-3 text-sm">
      {lines.map((l) => (
        <p key={l.text} className={l.tone === 'ok' ? 'text-emerald-700' : 'text-amber-700'}>
          {l.text}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">Очередь обрабатывается раз в час (/api/cron/review-requests).</p>
    </section>
  )
}

function MetricsCards({ metrics, onFilter }: { metrics: Metrics; onFilter: (status: string) => void }) {
  const cards: [string, number | string, string | null][] = [
    ['Запланированы', metrics.byStatus.scheduled, 'scheduled'],
    ['Отправлены', metrics.byStatus.sent, 'sent'],
    ['Ошибки', metrics.byStatus.failed, 'failed'],
    ['Не отправлены (правила)', metrics.byStatus.suppressed, 'suppressed'],
    ['Отменены', metrics.byStatus.cancelled, 'cancelled'],
    ['Отправлено за 30 дн.', metrics.sent30d, null],
    ['Отзывов по письмам', metrics.reviewsSubmitted, null],
    ['Конверсия', metrics.conversion === null ? '—' : `${Math.round(metrics.conversion * 1000) / 10}%`, null],
  ]
  return (
    <section aria-label="Сводка" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(([label, value, status]) =>
        status ? (
          <button key={label} type="button" onClick={() => onFilter(status)} className="rounded-lg border border-border p-3 text-left transition hover:border-gold/50">
            <span className="block text-xl font-semibold tabular-nums text-foreground">{value}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </button>
        ) : (
          <div key={label} className="rounded-lg border border-border p-3">
            <span className="block text-xl font-semibold tabular-nums text-foreground">{value}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ),
      )}
      <p className="col-span-2 text-[11px] text-muted-foreground sm:col-span-4">
        Конверсия — доля отправленных писем, после которых покупатель оставил хотя бы один отзыв по ссылке.
      </p>
    </section>
  )
}

function SettingsForm({
  initial,
  defaults,
  editable,
  onSaved,
}: {
  initial: ReviewRequestSettings
  defaults: ReviewRequestSettings
  editable: boolean
  onSaved: () => void
}) {
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = JSON.stringify(s) !== JSON.stringify(initial)

  function num(key: keyof ReviewRequestSettings, label: string, min: number, max: number, hint: string) {
    return (
      <Field label={label} hint={`${hint} (${min}–${max}; по умолчанию ${defaults[key] as number})`}>
        <input
          type="number"
          min={min}
          max={max}
          value={s[key] as number}
          disabled={!editable}
          onChange={(e) => setS({ ...s, [key]: Math.round(Number(e.target.value)) })}
          className={inputClass}
        />
      </Field>
    )
  }

  async function save() {
    if (s.consentMode === 'existing_customer' && initial.consentMode !== 'existing_customer') {
      const ok = window.confirm(
        'Режим «всем покупателям» допустим, только если при оформлении заказа покупателю сообщают, что он может отказаться от таких писем. Это сделано?',
      )
      if (!ok) return
    }
    if (s.enabled && !initial.enabled && !window.confirm('Включить отправку? Письма начнут уходить настоящим покупателям при следующем запуске.')) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/admin/review-requests/settings', { method: 'PUT', json: { settings: s } })
      onSaved()
    } catch (e) {
      const body = (e as { body?: { issues?: { path: string; message: string }[] } }).body
      setError(body?.issues?.length ? body.issues.map((i) => `${i.path}: ${i.message}`).join('; ') : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Настройки" className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Настройки</h2>
        {!editable && <span className="text-xs text-muted-foreground">Изменять настройки может только владелец.</span>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.enabled} disabled={!editable} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        Отправлять запросы отзывов
      </label>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {num('delayHours', 'Задержка после доставки, ч', 1, 720, 'Сколько ждать после подтверждённой доставки')}
        {num('cooldownDays', 'Пауза между письмами одному покупателю, дн.', 0, 90, 'Следующее письмо подождёт, а не пропадёт')}
        {num('staleAfterDays', 'Не писать, если доставка старше, дн.', 3, 180, 'Защита от устаревших писем после простоя')}
        {num('maxAttempts', 'Попыток отправки', 1, 10, 'Потом — «Ошибка»')}
        {num('linkValidDays', 'Ссылка действует, дн.', 7, 365, 'После отправки письма')}
        <Field label="Кому можно писать" hint="Юридический выбор владельца — см. docs/review-requests.md">
          <select value={s.consentMode} disabled={!editable} onChange={(e) => setS({ ...s, consentMode: e.target.value as ConsentMode })} className={inputClass}>
            {CONSENT_MODES.map((m) => (
              <option key={m} value={m}>
                {CONSENT_RU[m]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {editable && (
        <div className="flex gap-2">
          <Button tone="primary" onClick={save} busy={busy} disabled={!dirty}>
            Сохранить
          </Button>
          {dirty && <Button onClick={() => setS(initial)}>Сбросить</Button>}
        </div>
      )}
    </section>
  )
}

function PreviewAndTest({ recipients, canSend, mail }: { recipients: string[]; canSend: boolean; mail: Payload['mail'] }) {
  const [lang, setLang] = useState<string>('en')
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [to, setTo] = useState(recipients[0] ?? '')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<{ subject: string; html: string }>(`/api/admin/review-requests/preview?lang=${lang}`)
      .then((p) => alive && setPreview(p))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [lang])

  async function sendTest() {
    setSending(true)
    setError(null)
    setSent(null)
    try {
      await api('/api/admin/review-requests/test', { method: 'POST', json: { to, lang } })
      setSent(mail.mode === 'test' ? 'Письмо записано в лог (EMAIL_DELIVERY=test) — реально не отправлено.' : `Тестовое письмо принято почтовым сервисом для ${to}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section aria-label="Предпросмотр" className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-base font-semibold text-foreground">Предпросмотр письма</h2>
        <select aria-label="Язык" value={lang} onChange={(e) => setLang(e.target.value)} className={`${inputClass} w-auto`}>
          {LANGS.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        {canSend && recipients.length > 0 && (
          <>
            <select aria-label="Получатель теста" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} w-auto`}>
              {recipients.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button onClick={sendTest} busy={sending} disabled={!mail.configured}>
              Отправить тест
            </Button>
          </>
        )}
      </div>
      {canSend && recipients.length === 0 && (
        <p className="text-xs text-muted-foreground">Тестовые адреса не заданы (REVIEW_TEST_RECIPIENTS).</p>
      )}
      <p className="text-xs text-muted-foreground">
        Тест уходит только на адреса магазина — ввести произвольный адрес нельзя. Данные в письме — образец, ссылки не работают.
      </p>
      {sent && <p className="text-sm text-emerald-700">{sent}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {preview && (
        <>
          <p className="text-sm">
            <span className="text-muted-foreground">Тема:</span> {preview.subject}
          </p>
          {/* sandbox with no permissions: the email's markup runs no script and cannot navigate this page. */}
          <iframe title="Предпросмотр письма" sandbox="" srcDoc={preview.html} className="h-[640px] w-full rounded-lg border border-border bg-white" />
        </>
      )}
    </section>
  )
}
