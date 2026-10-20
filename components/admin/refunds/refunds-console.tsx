'use client'

import { ArrowLeft, Download, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { CLAIM_RU, RISK_RU, STATE_RU, chf, dateRu } from '@/lib/refunds/labels-ru'
import { CASE_STATES, CLAIM_TYPES, type CaseState, type ClaimType, type RiskLevel } from '@/lib/refunds/types'
import { NewCaseDialog } from './new-case'
import { RISK_TONE, STATE_TONE, Badge, Button, Spinner, api, inputClass, useMe } from './shared'
import { StaffBar } from './staff-bar'

/**
 * /admin/returns — the refund & return console: the figures, the queue
 * (filtered and paged by the server), and the way into each case. Filters
 * live in the address, so a view can be bookmarked or sent to a colleague.
 */

type Row = {
  id: string
  caseNumber: string
  orderNumber: string
  customerName?: string
  claimType: ClaimType
  state: CaseState
  requestedAmountMinor?: number
  approvedAmountMinor?: number
  refundedAmountMinor: number
  riskLevel?: RiskLevel
  riskScore?: number
  assignedLabel?: string
  escalated: boolean
  pendingApproval: boolean
  createdAt: number
}

type Overview = Record<string, number | undefined> & { byClaim90d: Record<string, number> }

const CARDS: [string, string, string][] = [
  ['open', 'Открытые', 'state=open'],
  ['awaitingDecision', 'Ждут решения', 'state=requested,under_review'],
  ['awaitingInspection', 'Ждут проверки', 'state=awaiting_inspection'],
  ['awaitingSecondApproval', 'Ждут 2-го согласования', 'pending=1'],
  ['approvedNotPaid', 'Одобрены, деньги не отправлены', 'state=approved'],
  ['refundProcessing', 'Возврат денег в обработке', 'state=refund_processing'],
  ['highRiskOpen', 'Высокий риск', 'state=open&risk=high'],
  ['overdue', 'Просрочены', 'overdue=1'],
  ['escalated', 'Эскалированы', 'state=open&escalated=1'],
  ['disputed', 'Спор по платежу', 'state=disputed'],
  ['refundsUnknown', 'Возвраты с неизвестным результатом', 'state=refund_processing'],
  ['refundsFailed30d', 'Неудачные возвраты (30 дн.)', 'state=approved'],
]

export function RefundsConsole() {
  const router = useRouter()
  const params = useSearchParams()
  const { me, error: meError, reload, can } = useMe()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState(params.get('q') ?? '')

  const query = params.toString()
  const page = Number(params.get('page') ?? '1') || 1
  const pageSize = 25
  const ready = me && me.mode !== 'unbound'

  const load = useCallback(() => {
    if (!ready) return
    setError(null)
    api<Overview>('/api/admin/refunds/overview').then(setOverview).catch((e: Error) => setError(e.message))
    api<{ rows: Row[]; total: number }>(`/api/admin/refunds/cases?${query || 'state=open'}`)
      .then((r) => {
        setRows(r.rows)
        setTotal(r.total)
      })
      .catch((e: Error) => setError(e.message))
  }, [query, ready])
  useEffect(() => load(), [load])

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    router.push(`/admin/returns?${next.toString()}`)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Панель управления
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Возвраты и претензии</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Каждое решение принимает человек. Одобрение и выплата — разные шаги; деньги уходят только кнопкой «Вернуть
            деньги» и только в пределах одобренной суммы.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/admin/returns/policy" className="rounded-lg border border-border px-3 py-2 hover:border-gold/50">
            Политика
          </Link>
          {can('staff.manage') && (
            <Link href="/admin/returns/staff" className="rounded-lg border border-border px-3 py-2 hover:border-gold/50">
              Сотрудники
            </Link>
          )}
        </div>
      </div>

      {meError && <p className="text-sm text-red-700">{meError}</p>}
      {me && <StaffBar me={me} onChange={reload} />}

      {ready && (
        <>
          {overview && (
            <section aria-label="Сводка" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {CARDS.map(([key, label, filter]) => (
                <Link key={key} href={`/admin/returns?${filter}`} className="rounded-lg border border-border p-3 transition hover:border-gold/50">
                  <span className="block text-xl font-semibold tabular-nums text-foreground">{overview[key] ?? 0}</span>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </Link>
              ))}
              <div className="col-span-2 rounded-lg border border-border p-3 sm:col-span-3 lg:col-span-6">
                <span className="text-sm text-foreground">
                  Возвращено за 30 дней: <strong>{chf(overview.refunded30dMinor)}</strong> ({overview.refundedCount30d ?? 0} возвр.)
                  {overview.medianResolutionHours !== undefined && <> · медиана решения: {Math.round((overview.medianResolutionHours ?? 0) / 24 * 10) / 10} дн.</>}
                  {' '}· новых сегодня: {overview.newToday ?? 0} · недоставка открыто: {overview.nonDeliveryOpen ?? 0}
                </span>
              </div>
            </section>
          )}

          <section aria-label="Фильтры" className="flex flex-wrap items-end gap-3">
            <select aria-label="Статус" value={params.get('state') ?? 'open'} onChange={(e) => setParam('state', e.target.value === 'all' ? null : e.target.value)} className={`${inputClass} w-auto`}>
              <option value="open">Все открытые</option>
              <option value="all">Все</option>
              {CASE_STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_RU[s]}
                </option>
              ))}
            </select>
            <select aria-label="Тип" value={params.get('claim') ?? ''} onChange={(e) => setParam('claim', e.target.value || null)} className={`${inputClass} w-auto`}>
              <option value="">Любой тип</option>
              {CLAIM_TYPES.map((c) => (
                <option key={c} value={c}>
                  {CLAIM_RU[c]}
                </option>
              ))}
            </select>
            <select aria-label="Риск" value={params.get('risk') ?? ''} onChange={(e) => setParam('risk', e.target.value || null)} className={`${inputClass} w-auto`}>
              <option value="">Любой риск</option>
              <option value="high">Высокий</option>
              <option value="medium">Средний</option>
              <option value="low">Низкий</option>
            </select>
            <select aria-label="Назначение" value={params.get('assigned') ?? ''} onChange={(e) => setParam('assigned', e.target.value || null)} className={`${inputClass} w-auto`}>
              <option value="">Все исполнители</option>
              {me?.mode === 'staff' && <option value="me">Мои</option>}
              <option value="none">Не назначены</option>
            </select>
            <select aria-label="Сортировка" value={params.get('sort') ?? 'newest'} onChange={(e) => setParam('sort', e.target.value === 'newest' ? null : e.target.value)} className={`${inputClass} w-auto`}>
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
              <option value="updated">По обновлению</option>
              <option value="amount">По сумме</option>
              <option value="risk">По риску</option>
            </select>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setParam('q', q.trim() || null)
              }}
              className="flex gap-2"
            >
              <input aria-label="Поиск" value={q} onChange={(e) => setQ(e.target.value)} placeholder="RC-…, LV-…, email, имя" className={`${inputClass} w-56`} />
              <Button type="submit">Найти</Button>
            </form>
            <div className="ml-auto flex gap-2">
              {can('case.export') && (
                <a href={`/api/admin/refunds/export?${query}`} className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-border px-3.5 text-sm hover:border-gold/50">
                  <Download className="size-4" /> CSV
                </a>
              )}
              {can('case.create') && (
                <Button tone="primary" onClick={() => setCreating(true)}>
                  <Plus className="size-4" /> Новая заявка
                </Button>
              )}
            </div>
          </section>

          {error && <p className="text-sm text-red-700">{error}</p>}
          {!rows ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">Заявок нет.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-normal">Заявка</th>
                    <th className="px-3 py-2 font-normal">Заказ / покупатель</th>
                    <th className="px-3 py-2 font-normal">Тип</th>
                    <th className="px-3 py-2 font-normal">Статус</th>
                    <th className="px-3 py-2 font-normal">Сумма</th>
                    <th className="px-3 py-2 font-normal">Риск</th>
                    <th className="px-3 py-2 font-normal">Исполнитель</th>
                    <th className="px-3 py-2 font-normal">Создана</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <Link href={`/admin/returns/${r.id}`} className="font-medium text-gold hover:underline">
                          {r.caseNumber}
                        </Link>
                        {r.escalated && <span className="ml-2"><Badge tone="red">эскалация</Badge></span>}
                        {r.pendingApproval && <span className="ml-2"><Badge tone="blue">2-е согласование</Badge></span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.orderNumber}
                        <span className="block text-xs text-muted-foreground">{r.customerName}</span>
                      </td>
                      <td className="px-3 py-2">{CLAIM_RU[r.claimType]}</td>
                      <td className="px-3 py-2">
                        <Badge tone={STATE_TONE[r.state]}>{STATE_RU[r.state]}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {chf(r.approvedAmountMinor ?? r.requestedAmountMinor)}
                        {r.refundedAmountMinor > 0 && <span className="block text-xs text-emerald-700">возвращено {chf(r.refundedAmountMinor)}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.riskLevel ? <Badge tone={RISK_TONE[r.riskLevel]}>{RISK_RU[r.riskLevel]} · {r.riskScore}</Badge> : '—'}
                      </td>
                      <td className="px-3 py-2">{r.assignedLabel ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{dateRu(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > pageSize && (
            <nav aria-label="Страницы" className="flex items-center gap-3 text-sm">
              <Button disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                ← Назад
              </Button>
              <span className="text-muted-foreground">
                Стр. {page} из {Math.ceil(total / pageSize)} · всего {total}
              </span>
              <Button disabled={page * pageSize >= total} onClick={() => setParam('page', String(page + 1))}>
                Вперёд →
              </Button>
            </nav>
          )}
        </>
      )}
      {creating && <NewCaseDialog onClose={() => setCreating(false)} onCreated={(id) => router.push(`/admin/returns/${id}`)} />}
    </div>
  )
}
