'use client'

import { ArrowLeft, Check, Loader2, Plus, Smartphone, Tag, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  PROMO_LIMITS,
  promoState,
  type AppWelcomeSettings,
  type PromoCode,
  type PromoKind,
  type PromoState,
} from '@/lib/promo-codes'
import type { PromoList } from '@/lib/server/promo-codes'
import { formatChf, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * /admin/promocodes, in the console's language (Russian, fixed).
 *
 * Three parts: a form for a new code (discount, how many people may use it,
 * how long it lasts), the list of codes with a bar of uses against the limit
 * and a state badge, and the terms of the installed app's personal code.
 * After every change the page is re-read from the server, so the counts are
 * always the database's.
 *
 * A code's uses are counted when an order is placed and given back when the
 * order is never paid (migration 0043) — the bar shows orders that hold a
 * use now.
 */

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold'

const STATE_BADGE: Record<PromoState, { label: string; className: string }> = {
  active: { label: 'Действует', className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' },
  exhausted: { label: 'Лимит исчерпан', className: 'border-amber-400/30 bg-amber-400/10 text-amber-300' },
  expired: { label: 'Истёк', className: 'border-red-400/30 bg-red-400/10 text-red-300' },
  inactive: { label: 'Выключен', className: 'border-border text-muted-foreground' },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function discountLabel(kind: PromoKind, value: number): string {
  return kind === 'percent' ? `−${value}%` : `−${formatChf(value)}`
}

/** "ещё 12 дн." / "сегодня" / "истёк 3 дн. назад". */
function expiryLabel(iso: string | null, now: number): string {
  if (!iso) return 'Бессрочно'
  const ms = Date.parse(iso) - now
  const days = Math.ceil(Math.abs(ms) / 86_400_000)
  if (ms <= 0) return `Истёк ${formatDate(iso)}`
  if (ms < 86_400_000) return `Истекает сегодня, ${new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
  return `До ${formatDate(iso)} · ещё ${days} дн.`
}

export function PromoCodesManager({
  list,
  appSettings,
  appSettingsStored,
}: {
  list: PromoList | null
  appSettings: AppWelcomeSettings
  appSettingsStored: boolean
}) {
  const [filter, setFilter] = useState<'all' | PromoState>('all')
  const codes = useMemo(() => list?.codes ?? [], [list])
  const now = Date.now()

  const counts = useMemo(() => {
    const c: Record<'all' | PromoState, number> = { all: codes.length, active: 0, exhausted: 0, expired: 0, inactive: 0 }
    for (const p of codes) c[promoState(p, now)] += 1
    return c
    // `now` is taken per render on purpose; the list is re-read after changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes])

  const visible = filter === 'all' ? codes : codes.filter((p) => promoState(p, now) === filter)

  return (
    <main id="main" className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/admin"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Назад в админ-панель
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gold/10">
            <Tag className="size-5 text-gold" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold text-foreground">Промокоды</h1>
            <p className="text-xs text-muted-foreground">
              Скидка, сколько человек может воспользоваться кодом и сколько он действует. Проверяются при оформлении заказа.
            </p>
          </div>
        </div>

        {list && !list.migrated && (
          <p className="mb-6 rounded-xl border border-gold/30 p-4 text-xs leading-relaxed text-muted-foreground">
            Миграция <code className="text-foreground">0043_promo_codes_admin.sql</code> ещё не применена: коды
            создаются и работают, но код приложения не выдаётся, а использования неоплаченных заказов не возвращаются.
          </p>
        )}

        {!list ? (
          <p role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
            Не удалось загрузить промокоды. Обновите страницу; если ошибка повторится — проверьте Supabase.
          </p>
        ) : (
          <>
            <CreateForm />

            <nav className="mb-4 mt-10 flex flex-wrap gap-2" aria-label="Фильтр промокодов">
              {(['all', 'active', 'exhausted', 'expired', 'inactive'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition',
                    filter === key ? 'border-gold/50 bg-gold/10 text-gold' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {key === 'all' ? 'Все' : STATE_BADGE[key].label}
                  <span className="tabular-nums text-xs opacity-70">{counts[key]}</span>
                </button>
              ))}
            </nav>

            {visible.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                {codes.length === 0 ? 'Промокодов пока нет — создайте первый выше.' : 'В этом разделе пусто.'}
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map((p) => (
                  <PromoRow key={p.id} promo={p} now={now} />
                ))}
              </ul>
            )}

            <AppCodeSettings initial={appSettings} stored={appSettingsStored} stats={list.appCodes} migrated={list.migrated} />
          </>
        )}
      </div>
    </main>
  )
}

// ------------------------------------------------------------ create form --

function CreateForm() {
  const router = useRouter()
  const { pushToast } = useStore()
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<PromoKind>('percent')
  const [value, setValue] = useState('10')
  const [limited, setLimited] = useState(true)
  const [maxUses, setMaxUses] = useState('100')
  const [validity, setValidity] = useState<'days' | 'date' | 'none'>('days')
  const [days, setDays] = useState('30')
  const [date, setDate] = useState('')
  const [minTotal, setMinTotal] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function generate() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    setCode(`LV-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/promocodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          kind,
          value: Number(value.replace(',', '.')),
          maxUses: limited ? Number(maxUses) : null,
          validForDays: validity === 'days' ? Number(days) : null,
          // datetime-local is local time without a zone; Date reads it as such.
          expiresAt: validity === 'date' && date ? new Date(date).toISOString() : null,
          minOrderTotal: minTotal.trim() ? Number(minTotal.replace(',', '.')) : null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Не удалось создать промокод')
        return
      }
      pushToast({ title: `Промокод ${body.promo?.code ?? code} создан`, variant: 'success' })
      setCode('')
      router.refresh()
    } catch {
      setError('Сеть недоступна — промокод не создан')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-6">
      <h2 className="mb-5 text-sm font-medium text-foreground">Новый промокод</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Код</span>
          <div className="flex gap-2">
            <input
              id="promo-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              maxLength={32}
              placeholder="SUMMER25"
              className={cn(INPUT, 'font-mono uppercase')}
            />
            <button
              type="button"
              onClick={generate}
              className="shrink-0 rounded-lg border border-border px-3 text-xs text-muted-foreground transition hover:text-foreground"
            >
              Сгенерировать
            </button>
          </div>
        </label>

        <fieldset>
          <legend className="mb-1.5 text-xs text-muted-foreground">Скидка</legend>
          <div className="flex gap-2">
            <input
              id="promo-value"
              type="number"
              inputMode="decimal"
              step={kind === 'percent' ? 1 : 0.01}
              min={PROMO_LIMITS[kind].min}
              max={PROMO_LIMITS[kind].max}
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={INPUT}
              aria-label="Размер скидки"
            />
            <select
              id="promo-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as PromoKind)}
              aria-label="Тип скидки"
              className="rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-gold"
            >
              <option value="percent">%</option>
              <option value="fixed">CHF</option>
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs text-muted-foreground">Сколько человек может воспользоваться</legend>
          <div className="flex items-center gap-3">
            <input
              id="promo-max-uses"
              type="number"
              inputMode="numeric"
              step={1}
              min={1}
              required={limited}
              disabled={!limited}
              value={limited ? maxUses : ''}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="∞"
              className={cn(INPUT, 'w-32')}
              aria-label="Лимит использований"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input id="promo-unlimited" type="checkbox" checked={!limited} onChange={(e) => setLimited(!e.target.checked)} />
              Без лимита
            </label>
          </div>
          <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground/70">
            Например, 100 — только первые сто заказов. Неоплаченный заказ возвращает использование.
          </span>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs text-muted-foreground">Срок действия</legend>
          <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(
              [
                ['days', 'Дней с сегодня'],
                ['date', 'До даты'],
                ['none', 'Бессрочно'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input type="radio" name="promo-validity" checked={validity === key} onChange={() => setValidity(key)} />
                {label}
              </label>
            ))}
          </div>
          {validity === 'days' && (
            <input
              id="promo-days"
              type="number"
              inputMode="numeric"
              step={1}
              min={PROMO_LIMITS.days.min}
              max={PROMO_LIMITS.days.max}
              required
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={cn(INPUT, 'w-32')}
              aria-label="Срок в днях"
            />
          )}
          {validity === 'date' && (
            <input
              id="promo-date"
              type="datetime-local"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={INPUT}
              aria-label="Дата и время окончания"
            />
          )}
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Минимальная сумма заказа, CHF (необязательно)</span>
          <input
            id="promo-min-total"
            type="number"
            inputMode="decimal"
            step={0.01}
            min={0}
            value={minTotal}
            onChange={(e) => setMinTotal(e.target.value)}
            className={cn(INPUT, 'w-40')}
          />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-sm font-medium text-gold-foreground transition disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Создать промокод
        </button>
        {error && (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}

// -------------------------------------------------------------- one code --

function PromoRow({ promo, now }: { promo: PromoCode; now: number }) {
  const router = useRouter()
  const { pushToast } = useStore()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [maxUses, setMaxUses] = useState(promo.maxUses === null ? '' : String(promo.maxUses))
  const [error, setError] = useState<string | null>(null)

  const state = promoState(promo, now)
  const badge = STATE_BADGE[state]
  const pct = promo.maxUses ? Math.min(100, Math.round((promo.used / promo.maxUses) * 100)) : 0
  const left = promo.maxUses === null ? null : Math.max(0, promo.maxUses - promo.used)

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/promocodes/${encodeURIComponent(promo.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Не удалось сохранить')
        return
      }
      pushToast({ title: done, variant: 'success' })
      setEditing(false)
      router.refresh()
    } catch {
      setError('Сеть недоступна — изменения не сохранены')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Удалить промокод ${promo.code}? Это нельзя отменить.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/promocodes/${encodeURIComponent(promo.id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Не удалось удалить')
        return
      }
      pushToast({ title: `Промокод ${promo.code} удалён`, variant: 'default' })
      router.refresh()
    } catch {
      setError('Сеть недоступна — промокод не удалён')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-base font-semibold text-foreground">{promo.code}</p>
            <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', badge.className)}>{badge.label}</span>
            <span className="text-sm font-medium text-gold">{discountLabel(promo.kind, promo.value)}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {expiryLabel(promo.expiresAt, now)}
            {promo.validForDays ? ` · задан как ${promo.validForDays} дн.` : ''}
            {promo.minOrderTotal ? ` · от ${formatChf(promo.minOrderTotal)}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ active: !promo.active }, promo.active ? `${promo.code} выключен` : `${promo.code} включён`)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            {promo.active ? 'Выключить' : 'Включить'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            Лимит
          </button>
          {promo.used === 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              aria-label={`Удалить ${promo.code}`}
              title="Удалить (только если код ни разу не применялся)"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Uses against the limit. */}
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            Использовано {promo.used}
            {promo.maxUses !== null ? ` из ${promo.maxUses}` : ''}
          </span>
          <span className="tabular-nums">{left === null ? 'Без лимита' : `Осталось ${left}`}</span>
        </div>
        {promo.maxUses !== null && (
          <div
            role="progressbar"
            aria-label={`Использовано ${promo.used} из ${promo.maxUses}`}
            aria-valuemin={0}
            aria-valuemax={promo.maxUses}
            aria-valuenow={promo.used}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-amber-400' : pct >= 80 ? 'bg-gold' : 'bg-emerald-400')}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <label htmlFor={`promo-limit-${promo.id}`} className="text-xs text-muted-foreground">
            Новый лимит:
          </label>
          <input
            id={`promo-limit-${promo.id}`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="∞ (пусто)"
            className="w-32 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-gold"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              patch({ maxUses: maxUses.trim() ? Number(maxUses) : null }, `Лимит ${promo.code} сохранён`)
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-medium text-gold-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Сохранить
          </button>
          {promo.maxUses !== null && Number(maxUses) > 0 && Number(maxUses) < promo.used && (
            <span className="text-[11px] text-amber-300">Меньше уже использованного — код сразу станет исчерпан</span>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {error}
        </p>
      )}
    </li>
  )
}

// ------------------------------------------------------ app welcome code --

function AppCodeSettings({
  initial,
  stored,
  stats,
  migrated,
}: {
  initial: AppWelcomeSettings
  stored: boolean
  stats: PromoList['appCodes']
  migrated: boolean
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [kind, setKind] = useState<PromoKind>(initial.kind)
  const [value, setValue] = useState(String(initial.value))
  const [maxUses, setMaxUses] = useState(String(initial.maxUses))
  const [days, setDays] = useState(String(initial.validForDays))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/admin/promocodes/app-code', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          kind,
          value: Number(value.replace(',', '.')),
          maxUses: Number(maxUses),
          validForDays: Number(days),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Ошибка ${res.status}`)
      setStatus({ kind: 'ok', text: 'Сохранено. Действует для кодов, выданных с этого момента.' })
      router.refresh()
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="app-code-title" className="mt-12 rounded-2xl border border-border bg-card p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold/10">
          <Smartphone className="size-4 text-gold" />
        </div>
        <div>
          <h2 id="app-code-title" className="text-sm font-medium text-foreground">
            Код приложения
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Личный код, который получает каждый покупатель при первом запуске установленного приложения (нужен вход в
            аккаунт). Один на аккаунт, работает только у своего владельца. Покупатель видит его в кабинете — текстом и
            QR-кодом.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Выдано: <span className="tabular-nums text-foreground">{stats.issued}</span> · использовано:{' '}
            <span className="tabular-nums text-foreground">{stats.used}</span>
            {!stored && ' · сейчас действуют значения по умолчанию (−10%, 1 раз, 30 дней), как обещает баннер на сайте'}
          </p>
        </div>
      </div>

      {!migrated ? (
        <p className="text-xs text-muted-foreground">Станет доступно после применения миграции 0043.</p>
      ) : (
        <form onSubmit={save}>
          <div className="grid gap-5 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-4">
              <input id="app-code-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Выдавать код в приложении
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-xs text-muted-foreground">Скидка</legend>
              <div className="flex gap-2">
                <input
                  id="app-code-value"
                  type="number"
                  inputMode="decimal"
                  step={kind === 'percent' ? 1 : 0.01}
                  min={PROMO_LIMITS[kind].min}
                  max={PROMO_LIMITS[kind].max}
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={INPUT}
                  aria-label="Размер скидки"
                />
                <select
                  id="app-code-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as PromoKind)}
                  aria-label="Тип скидки"
                  className="rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-gold"
                >
                  <option value="percent">%</option>
                  <option value="fixed">CHF</option>
                </select>
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">Раз на код</span>
              <input
                id="app-code-uses"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                required
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">Действует, дней</span>
              <input
                id="app-code-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                step={1}
                required
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className={INPUT}
              />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-sm font-medium text-gold-foreground transition disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Сохранить
            </button>
            {status && (
              <p
                role={status.kind === 'error' ? 'alert' : 'status'}
                className={cn('text-xs leading-relaxed', status.kind === 'ok' ? 'text-gold' : 'text-red-400')}
              >
                {status.text}
              </p>
            )}
          </div>
        </form>
      )}

      {stats.recent.length > 0 && (
        <details className="mt-6 border-t border-border pt-4">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Последние выданные коды ({Math.min(stats.recent.length, 50)})
          </summary>
          <ul className="mt-3 space-y-1.5 text-xs">
            {stats.recent.map((p) => {
              const s = promoState(p)
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-foreground">{p.code}</span>
                  <span className="text-muted-foreground">{discountLabel(p.kind, p.value)}</span>
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', STATE_BADGE[s].className)}>
                    {p.used > 0 ? 'Использован' : STATE_BADGE[s].label}
                  </span>
                  <span className="text-muted-foreground/70">выдан {formatDate(p.createdAt)}</span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </section>
  )
}
