'use client'

import { ArrowLeft, Check, Gift, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ORDER_STATUS_LABELS_RU, PAYMENT_STATUS_LABELS_RU } from '@/lib/admin-labels'
import { REFERRAL_DISCOUNT_RANGE, REFERRAL_REWARD_RANGE } from '@/lib/referral-program'
import type { AdminReferralData, AdminReferralRow } from '@/lib/server/referral-admin'
import type { ReferralSettings } from '@/lib/server/referral-settings'
import { formatChf, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * /admin/referrals, in the console's language (Russian, fixed).
 *
 * Two jobs: the programme's two numbers, and the list of invited friends with
 * the payout of each reward. Rewards are paid BY HAND — a bank transfer,
 * TWINT — and marked here afterwards; nothing on this page moves money. After
 * each change the page is re-read from the server rather than patched, so it
 * always shows what the database says.
 */

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold'

type Filter = 'all' | 'to_pay' | 'paid_out' | 'waiting' | 'void'

/** Where a referral stands, from the point of view of paying its reward. */
function stage(row: AdminReferralRow): Exclude<Filter, 'all'> {
  if (row.status === 'reward_paid') return row.paidOutAt ? 'paid_out' : 'to_pay'
  if (row.status === 'void') return 'void'
  return 'waiting'
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'to_pay', label: 'К выплате' },
  { key: 'paid_out', label: 'Выплачено' },
  { key: 'waiting', label: 'Ждут оплаты заказа' },
  { key: 'void', label: 'Аннулированы' },
  { key: 'all', label: 'Все' },
]

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function ReferralsManager({ settings, data }: { settings: ReferralSettings; data: AdminReferralData }) {
  const rows = useMemo(() => (data.available ? data.rows : []), [data])

  const [filter, setFilter] = useState<Filter>(() =>
    rows.some((r) => stage(r) === 'to_pay') ? 'to_pay' : 'all',
  )

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, to_pay: 0, paid_out: 0, waiting: 0, void: 0 }
    for (const r of rows) c[stage(r)] += 1
    return c
  }, [rows])

  const totals = useMemo(() => {
    let toPay = 0
    let paidOut = 0
    let paidOrders = 0
    for (const r of rows) {
      const s = stage(r)
      if (s === 'to_pay') toPay += r.reward
      if (s === 'paid_out') paidOut += r.reward
      if (r.status === 'reward_paid' || (r.status === 'void' && r.rewardedAt)) paidOrders += 1
    }
    return { toPay: round2(toPay), paidOut: round2(paidOut), paidOrders }
  }, [rows])

  const visible = filter === 'all' ? rows : rows.filter((r) => stage(r) === filter)

  return (
    <main id="main" className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/admin"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Назад в админ-панель
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gold/10">
            <Gift className="size-5 text-gold" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold text-foreground">Реферальная программа</h1>
            <p className="text-xs text-muted-foreground">
              Скидка другу на первый заказ и бонус пригласившему — после того как друг оплатил заказ.
            </p>
          </div>
        </div>

        {(!settings.stored || (data.available && !data.payoutsEnabled)) && (
          <p className="mb-6 rounded-xl border border-gold/30 p-4 text-xs leading-relaxed text-muted-foreground">
            Миграция <code className="text-foreground">0041_referral_admin.sql</code> ещё не применена. Пока
            действуют значения из переменных окружения ({settings.friendDiscountPercent}% и{' '}
            {formatChf(settings.referrerRewardAmount)}), сохранить новые и отмечать выплаты нельзя.
          </p>
        )}

        <SettingsForm settings={settings} />

        {!data.available ? (
          <p className="mt-8 rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            Таблицы реферальной программы не найдены — примените миграцию{' '}
            <code className="text-foreground">0036_referrals.sql</code>.
          </p>
        ) : (
          <>
            <section aria-label="Сводка" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Приглашено друзей" value={String(rows.length)} />
              <Stat label="Оплатили заказ" value={String(totals.paidOrders)} />
              <Stat label="К выплате" value={formatChf(totals.toPay)} accent={totals.toPay > 0} />
              <Stat label="Выплачено" value={formatChf(totals.paidOut)} />
            </section>

            {/* Client-side: the whole list is already here (the page reads up
                to 500 rows), so switching tabs needs no round trip. */}
            <nav className="mb-4 mt-8 flex flex-wrap gap-2" aria-label="Фильтр">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition',
                    filter === f.key
                      ? 'border-gold/50 bg-gold/10 text-gold'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                  <span className="tabular-nums text-xs opacity-70">{counts[f.key]}</span>
                </button>
              ))}
            </nav>

            {visible.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                {rows.length === 0 ? 'По реферальным ссылкам пока никто не пришёл.' : 'В этом разделе пусто.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Пригласил</th>
                      <th className="px-4 py-3 font-medium">Друг</th>
                      <th className="px-4 py-3 font-medium">Заказ</th>
                      <th className="px-4 py-3 text-right font-medium">Бонус</th>
                      <th className="px-4 py-3 font-medium">Выплата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <ReferralRow key={row.id} row={row} payoutsEnabled={data.payoutsEnabled} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', accent ? 'text-gold' : 'text-foreground')}>{value}</p>
    </div>
  )
}

function SettingsForm({ settings }: { settings: ReferralSettings }) {
  const router = useRouter()
  const [discount, setDiscount] = useState(String(settings.friendDiscountPercent))
  const [reward, setReward] = useState(String(settings.referrerRewardAmount))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const dirty =
    Number(discount) !== settings.friendDiscountPercent || Number(reward) !== settings.referrerRewardAmount

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/admin/referrals/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendDiscountPercent: Number(discount), referrerRewardAmount: Number(reward) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Ошибка ${res.status}`)
      setStatus({ kind: 'ok', text: 'Сохранено. Действует для новых заказов и оплат.' })
      router.refresh()
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-card p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Скидка другу на первый заказ, %</span>
          <input
            id="referral-discount"
            type="number"
            inputMode="numeric"
            step="1"
            min={REFERRAL_DISCOUNT_RANGE.min}
            max={REFERRAL_DISCOUNT_RANGE.max}
            required
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className={INPUT}
          />
          <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground/70">
            От {REFERRAL_DISCOUNT_RANGE.min} до {REFERRAL_DISCOUNT_RANGE.max}%, от суммы товаров.
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Бонус пригласившему, CHF</span>
          <input
            id="referral-reward"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={REFERRAL_REWARD_RANGE.min}
            max={REFERRAL_REWARD_RANGE.max}
            required
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            className={INPUT}
          />
          <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground/70">
            Начисляется, когда друг оплатил первый заказ; снимается, если заказ возвращён.
          </span>
        </label>
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground/70">
        Новые значения применяются к заказам и оплатам после сохранения. Уже начисленные бонусы не
        меняются — у каждого остаётся сумма, с которой он был начислен.
        {settings.updatedAt && ` Последнее изменение: ${formatDate(settings.updatedAt)}.`}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={saving || !dirty}
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
  )
}

function ReferralRow({ row, payoutsEnabled }: { row: AdminReferralRow; payoutsEnabled: boolean }) {
  const router = useRouter()
  const { pushToast } = useStore()
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const s = stage(row)

  async function markPaid() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/referrals/${encodeURIComponent(row.id)}/payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Не удалось отметить выплату')
        return
      }
      pushToast({
        title: body?.already ? 'Выплата уже была отмечена' : `Выплата ${formatChf(row.reward)} отмечена`,
        description: row.referrer.name,
        variant: 'success',
      })
      setConfirming(false)
      router.refresh()
    } catch {
      setError('Сеть недоступна — выплата не отмечена')
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-4 py-3">
        <p className="text-foreground">{row.referrer.name}</p>
        <p className="text-xs text-muted-foreground">{row.referrer.email}</p>
        {row.referrer.code && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/60">{row.referrer.code}</p>}
      </td>

      <td className="px-4 py-3">
        <p className="text-foreground">{row.friend.name ?? '—'}</p>
        <p className="text-xs text-muted-foreground">{row.friend.email}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/60">
          {row.friend.hasAccount ? 'с аккаунтом' : 'гость'} · с {formatDate(row.createdAt)}
        </p>
      </td>

      <td className="px-4 py-3">
        {row.order ? (
          <>
            <p className="font-medium text-foreground">{row.order.number}</p>
            <p className="text-xs text-muted-foreground">
              {[
                row.order.status ? ORDER_STATUS_LABELS_RU[row.order.status] : null,
                row.order.paymentStatus ? PAYMENT_STATUS_LABELS_RU[row.order.paymentStatus] : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'заказ не найден'}
            </p>
            {row.order.total !== null && (
              <p className="text-[11px] text-muted-foreground/60">{formatChf(row.order.total)}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Заказа ещё нет</p>
        )}
      </td>

      <td className="px-4 py-3 text-right tabular-nums">
        {row.status === 'reward_paid' || row.status === 'void' ? (
          <span className={cn(row.status === 'void' ? 'text-muted-foreground line-through' : 'font-medium text-foreground')}>
            {formatChf(row.reward)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      <td className="px-4 py-3">
        {s === 'waiting' && (
          <Badge className="border-border text-muted-foreground">
            {row.status === 'order_placed' ? 'Ждёт оплаты заказа' : 'Ждёт первого заказа'}
          </Badge>
        )}

        {s === 'void' && (
          <>
            <Badge className="border-red-400/30 bg-red-400/10 text-red-300">Аннулирован — заказ возвращён</Badge>
            {row.paidOutAt && (
              // The reward was handed over before the refund: the customer's
              // balance is now negative by that amount.
              <p className="mt-1.5 max-w-[220px] text-[11px] leading-relaxed text-amber-300">
                Бонус был выплачен {formatDate(row.paidOutAt)} — баланс клиента ушёл в минус.
              </p>
            )}
          </>
        )}

        {s === 'paid_out' && (
          <>
            <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
              Выплачено {formatDate(row.paidOutAt)}
            </Badge>
            {row.payoutNote && <p className="mt-1.5 max-w-[220px] text-[11px] text-muted-foreground">{row.payoutNote}</p>}
          </>
        )}

        {s === 'to_pay' && (
          <div className="max-w-[240px]">
            <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
              К выплате · начислен {formatDate(row.rewardedAt)}
            </Badge>

            {payoutsEnabled && !confirming && (
              <button
                type="button"
                onClick={() => {
                  setConfirming(true)
                  setError(null)
                }}
                className="mt-2 block text-xs text-gold underline-offset-4 hover:underline"
              >
                Отметить выплату
              </button>
            )}

            {confirming && (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Вы уже перевели {formatChf(row.reward)} клиенту {row.referrer.name}? Отметку нельзя отменить.
                </p>
                <input
                  id={`payout-note-${row.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder="Комментарий: способ, дата…"
                  aria-label="Комментарий к выплате"
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-gold"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={markPaid}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-medium text-gold-foreground disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                    Да, выплачено
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-1.5 text-[11px] text-red-400">
                {error}
              </p>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium', className)}>
      {children}
    </span>
  )
}
