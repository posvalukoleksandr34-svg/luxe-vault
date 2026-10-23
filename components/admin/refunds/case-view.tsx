'use client'

import { ArrowLeft, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ADVICE_REASON_RU,
  ADVICE_RU,
  CLAIM_RU,
  COMMAND_RU,
  EVIDENCE_RU,
  FINDING_RU,
  INSPECTION_RU,
  INVESTIGATION_RU,
  RESOLUTION_RU,
  RISK_RU,
  STATE_RU,
  TRACKING_RU,
  TX_STATUS_RU,
  chf,
  dateRu,
} from '@/lib/refunds/labels-ru'
import type { AdviceReason, NonDeliveryAdvice } from '@/lib/refunds/delivery'
import { EVIDENCE_KINDS } from '@/lib/refunds/types'
import type { CaseState, ClaimType, EvidenceKind, InspectionOutcome, InvestigationStatus, Resolution, RiskLevel, TrackingStatus, TransactionStatus } from '@/lib/refunds/types'
import { ActionForm } from './case-actions'
import { RISK_TONE, STATE_TONE, Badge, Button, Spinner, api, inputClass, useMe } from './shared'
import { StaffBar } from './staff-bar'

/**
 * One refund case, for staff (/admin/returns/[id]): the request, the order as
 * charged and the ledger, evidence, the risk assessment WITH its reasons, the
 * non-delivery advice, messages and internal notes, the audit trail — and the
 * actions this role may take now. Every action re-reads the case afterwards,
 * so what is shown is what the database says.
 */

export type Detail = {
  case: {
    id: string
    caseNumber: string
    orderNumber: string
    claimType: ClaimType
    state: CaseState
    version: number
    requestedResolution: Resolution
    approvedResolution?: Resolution
    requestedAmountMinor?: number
    approvedAmountMinor?: number
    refundedAmountMinor: number
    assignedLabel?: string
    escalatedAt?: number
    escalationReason?: string
    customerDeadlineAt?: number
    waitUntil?: number
    investigationStatus: InvestigationStatus
    carrierClaimRef?: string
    policyVersion?: number
    eligibility?: { manualReview?: string[]; deadline?: number | null; waitUntil?: number | null }
    decisionNote?: string
    pendingApproval?: { byLabel: string; at: number; resolution: Resolution; amountMinor: number; note?: string; justification?: string; lines: { itemId: string; qty: number }[] }
    approval?: { itemsMinor: number; shippingMinor: number; returnPostageMinor: number; deductionMinor: number; deductionReason?: string; computedMinor: number; includesShipping: boolean; warnings: string[]; policyOverride?: string }
    appealCount: number
    source: string
    returnTrackingNumber?: string
    returnCarrier?: string
    returnShippedAt?: number
    returnReceivedAt?: number
    disputeRef?: string
    resolutionRef?: string
    riskLevel?: RiskLevel
    riskScore?: number
    finding?: string
    findingNote?: string
    comment: string
    images: string[]
    createdAt: number
    customerName?: string
    customerEmail?: string
  }
  items: {
    id: string
    name: string
    size: string
    color: string
    image?: string
    orderedQty: number
    qtyRequested: number
    qtyApproved?: number
    qtyReceived: number
    unitPriceMinor: number
    inspectionOutcome?: InspectionOutcome
    inspectionNote?: string
    restockedQty: number
  }[]
  order: {
    number: string
    status: string
    paymentStatus?: string
    paymentProvider?: string
    paymentCurrency?: string
    paymentAmount?: number
    createdAt: number
    shippedAt?: number
    deliveredAt?: number
    expectedDeliveryBy?: number
    trackingNumber?: string
    courierName?: string
    customerName: string
    customerEmail?: string
    subtotalMinor: number
    discountMinor: number
    shippingMinor: number
    taxMinor: number
    totalMinor: number
    refundedMinor: number
    committedMinor: number
    inFlight: boolean
  } | null
  ledger: { id: string; provider: string; amountMinor: number; providerAmountMinor?: number; providerCurrency?: string; status: TransactionStatus; source: string; caseId?: string; initiatedByLabel?: string; manualReference?: string; providerRefundId?: string; failureCode?: string; failureMessage?: string; attempts: number; createdAt: number; settledAt?: number }[]
  evidence: { id: string; kind: EvidenceKind; source: string; title?: string; mimeType?: string; sizeBytes?: number; sha256?: string; data: Record<string, unknown>; capturedAt: number; recordedAt: number; recordedByLabel: string; purgedAt?: number; hasFile: boolean }[]
  trackingSnapshot: { status: TrackingStatus; carrier?: string; trackingNumber?: string; deliveredAt?: number; signatureObtained?: boolean; source: string; retrievedAt: number } | null
  messages: { id: string; authorType: string; authorLabel: string; visibility: 'customer' | 'internal'; body: string; createdAt: number }[]
  events: { id: number; actorType: string; actorLabel: string; action: string; fromState?: string; toState?: string; reason?: string; data: Record<string, unknown>; createdAt: number }[]
  risk: { score: number; level: RiskLevel; engineVersion: string; policyVersion: number; evaluatedAt: number; heldAtMedium?: boolean; explanations: { rule: string; weight: number; basis: string; facts: Record<string, unknown>; text: string }[]; history: { score: number; level: RiskLevel; evaluatedAt: number }[] } | null
  approvals: { kind: string; staffLabel: string; amountMinor: number; resolution: string; note?: string; createdAt: number }[]
  history: { orders: number; totalSpentMinor: number; cases: { id: string; caseNumber: string; orderNumber: string; claimType: string; state: string; createdAt: number; amountMinor?: number; finding?: string }[] } | null
  commands: string[]
  advice: { advice: NonDeliveryAdvice; reasons: AdviceReason[]; conflicts: string[] } | null
  preview: { calc: { totalMinor: number; computedMinor: number; refundableBalanceMinor: number; includesShipping: boolean; warnings: string[] } | null; needsSecondApproval: boolean } | null
}

export function CaseView({ id }: { id: string }) {
  const { me, reload: reloadMe } = useMe()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Detail>(`/api/admin/refunds/cases/${id}`)
      .then((x) => {
        setD(x)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])
  useEffect(() => {
    if (me && me.mode !== 'unbound') load()
  }, [load, me])

  const back = (
    <Link href="/admin/returns" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Все заявки
    </Link>
  )
  if (!me) return <div className="mx-auto max-w-6xl">{back}<div className="mt-6"><Spinner /></div></div>
  if (me.mode === 'unbound') return <div className="mx-auto max-w-6xl space-y-6">{back}<StaffBar me={me} onChange={reloadMe} /></div>
  if (error) return <div className="mx-auto max-w-6xl space-y-4">{back}<p className="text-sm text-red-700">{error}</p></div>
  if (!d) return <div className="mx-auto max-w-6xl">{back}<div className="mt-6"><Spinner /></div></div>

  const c = d.case
  const actions = d.commands.filter((x) => !['add_note', 'send_message', 'restock', 'customer_message'].includes(x))

  async function openEvidence(evidenceId: string) {
    try {
      const r = await api<{ url: string }>(`/api/admin/refunds/evidence/${evidenceId}`)
      window.open(r.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const done = (message?: string) => {
    setActive(null)
    setNotice(message ?? null)
    load()
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {back}
      <StaffBar me={me} onChange={reloadMe} />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-serif text-2xl font-semibold">
            {c.caseNumber} <Badge tone={STATE_TONE[c.state]}>{STATE_RU[c.state]}</Badge>
          </h1>
          <p className="break-words text-sm text-muted-foreground">
            {CLAIM_RU[c.claimType]} · просит: {RESOLUTION_RU[c.requestedResolution]} · заказ {c.orderNumber} · {c.customerName} {c.customerEmail && `<${c.customerEmail}>`} · создана {dateRu(c.createdAt)} ({c.source === 'staff' ? 'сотрудником' : 'покупателем'}) · политика v{c.policyVersion ?? 0}
          </p>
          <p className="text-sm text-muted-foreground">
            Исполнитель: {c.assignedLabel ?? 'не назначен'}
            {c.escalatedAt && <> · <Badge tone="red">эскалация: {c.escalationReason}</Badge></>}
            {c.customerDeadlineAt && <> · срок покупателю: {dateRu(c.customerDeadlineAt)}</>}
            {c.waitUntil && <> · ждём доставку до {dateRu(c.waitUntil)}</>}
          </p>
        </div>
        {c.riskLevel && (
          <div className="text-right">
            <Badge tone={RISK_TONE[c.riskLevel]}>Риск: {RISK_RU[c.riskLevel]} · {c.riskScore}</Badge>
            <p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">Подсказка для проверки, не решение. Один признак никогда не означает мошенничество.</p>
          </div>
        )}
      </header>

      {notice && <p className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">{notice}</p>}

      {c.pendingApproval && (
        <section className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-4 text-sm">
          <strong>Ждёт второго согласования.</strong> {c.pendingApproval.byLabel} одобрил(а) {RESOLUTION_RU[c.pendingApproval.resolution]} на {chf(c.pendingApproval.amountMinor)} · {dateRu(c.pendingApproval.at)}
          {c.pendingApproval.justification && <span className="block text-muted-foreground">Обоснование: {c.pendingApproval.justification}</span>}
        </section>
      )}

      <section aria-label="Действия" className="space-y-3 rounded-lg border border-gold/30 p-4">
        <h2 className="text-sm font-semibold">Действия</h2>
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">В этом статусе действий нет (или недостаточно прав).</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {actions.map((cmd) => (
              <Button key={cmd} tone={active === cmd ? 'primary' : cmd === 'reject' || cmd === 'cancel' ? 'danger' : 'default'} onClick={() => setActive(active === cmd ? null : cmd)}>
                {COMMAND_RU[cmd] ?? cmd}
              </Button>
            ))}
          </div>
        )}
        {active && <ActionForm command={active} detail={d} me={me} onDone={done} onCancel={() => setActive(null)} />}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-2 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Заявка покупателя</h2>
            <p className="whitespace-pre-line text-sm">{c.comment || <span className="text-muted-foreground">Без описания</span>}</p>
            {c.eligibility?.manualReview && c.eligibility.manualReview.length > 0 && (
              <p className="text-xs text-amber-700">Нужна ручная оценка: {c.eligibility.manualReview.join(', ')}</p>
            )}
            {c.decisionNote && <p className="text-sm">Решение для покупателя: «{c.decisionNote}»</p>}
            {c.finding && <p className="text-sm">Вывод: <strong>{FINDING_RU[c.finding]}</strong> — {c.findingNote}</p>}
          </section>

          <section className="space-y-2 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Позиции</h2>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-normal">Товар</th>
                  <th className="py-1 text-right font-normal">Цена</th>
                  <th className="py-1 text-right font-normal">Заявл./Одобр./Получ.</th>
                  <th className="py-1 text-left font-normal">Проверка</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id} className="border-t border-border/60">
                    <td className="py-1.5">
                      {i.name} · {i.size} · {i.color} <span className="text-xs text-muted-foreground">(в заказе {i.orderedQty})</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{chf(i.unitPriceMinor)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {i.qtyRequested} / {i.qtyApproved ?? '—'} / {i.qtyReceived}
                    </td>
                    <td className="py-1.5">
                      {i.inspectionOutcome ? INSPECTION_RU[i.inspectionOutcome] : '—'}
                      {i.inspectionNote && <span className="block text-xs text-muted-foreground">{i.inspectionNote}</span>}
                      {i.restockedQty > 0 && <span className="block text-xs text-emerald-700">на складе: {i.restockedQty}</span>}
                      {d.commands.includes('restock') && i.inspectionOutcome === 'accepted' && i.restockedQty < i.qtyReceived && (
                        <RestockButton caseId={c.id} itemId={i.id} version={c.version} onDone={done} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {c.returnTrackingNumber && (
              <p className="text-xs text-muted-foreground">
                Возврат: {c.returnTrackingNumber} {c.returnCarrier && `(${c.returnCarrier})`} · отправлен {dateRu(c.returnShippedAt)} · получен {dateRu(c.returnReceivedAt)}
              </p>
            )}
          </section>

          {d.order && (
            <section className="space-y-2 rounded-lg border border-border p-4 text-sm">
              <h2 className="font-semibold">Заказ и деньги</h2>
              <p>
                {d.order.number} · {d.order.status} · оплата: {d.order.paymentProvider ?? '—'} {d.order.paymentStatus}
                {d.order.paymentCurrency && d.order.paymentCurrency !== 'CHF' ? ` · списано ${d.order.paymentAmount} ${d.order.paymentCurrency}` : ''}
              </p>
              <p className="tabular-nums">
                Товары {chf(d.order.subtotalMinor)} − скидка {chf(d.order.discountMinor)} + доставка {chf(d.order.shippingMinor)} + налог {chf(d.order.taxMinor)} = <strong>{chf(d.order.totalMinor)}</strong>
              </p>
              <p className="tabular-nums">
                Возвращено: <strong>{chf(d.order.refundedMinor)}</strong> · в работе/зарезервировано: {chf(d.order.committedMinor - d.order.refundedMinor)} · можно вернуть ещё: <strong>{chf(d.order.totalMinor - d.order.committedMinor)}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Отправлен {dateRu(d.order.shippedAt)} · доставлен {dateRu(d.order.deliveredAt)} · ожидалось до {dateRu(d.order.expectedDeliveryBy, false)} · трек {d.order.trackingNumber ?? 'нет'} {d.order.courierName && `(${d.order.courierName})`}
              </p>
              {c.approval && (
                <p className="text-xs">
                  Одобрено: товары {chf(c.approval.itemsMinor)} + доставка {chf(c.approval.shippingMinor)} + обратная пересылка {chf(c.approval.returnPostageMinor)} − удержание {chf(c.approval.deductionMinor)}
                  {c.approval.deductionReason && ` (${c.approval.deductionReason})`} = {chf(c.approval.computedMinor)}; к выплате {chf(c.approvedAmountMinor)}
                  {c.approval.policyOverride && <span className="block text-amber-700">Отступление от политики: {c.approval.policyOverride}</span>}
                </p>
              )}
              {d.ledger.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="text-left font-normal">Возврат</th>
                        <th className="text-right font-normal">Сумма</th>
                        <th className="text-left font-normal">Статус</th>
                        <th className="text-left font-normal">Кто / откуда</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.ledger.map((t) => (
                        <tr key={t.id} className="border-t border-border/60 align-top">
                          <td className="py-1">
                            {t.provider} {t.providerRefundId ?? t.manualReference ?? ''}
                            <span className="block text-muted-foreground">{dateRu(t.createdAt)}{t.caseId === c.id ? ' · эта заявка' : t.caseId ? ' · другая заявка' : ''}</span>
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {chf(t.amountMinor)}
                            {t.providerCurrency && t.providerCurrency !== 'CHF' && t.providerAmountMinor !== undefined && (
                              <span className="block text-muted-foreground">{(t.providerAmountMinor / 100).toFixed(2)} {t.providerCurrency}</span>
                            )}
                          </td>
                          <td className="py-1">
                            <Badge tone={t.status === 'succeeded' ? 'green' : t.status === 'failed' || t.status === 'canceled' ? 'red' : 'amber'}>{TX_STATUS_RU[t.status]}</Badge>
                            {t.failureMessage && <span className="block text-red-700">{t.failureMessage}</span>}
                          </td>
                          <td className="py-1">
                            {t.initiatedByLabel} · {t.source}
                          </td>
                          <td className="py-1">
                            {['pending_submission', 'submitted', 'unknown'].includes(t.status) && me.permissions.includes('refund.execute') && <ReleaseButton txId={t.id} onDone={done} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <EvidencePanel d={d} onOpen={openEvidence} onDone={done} canAdd={d.commands.includes('record_evidence')} />

          <Messages d={d} canNote={d.commands.includes('add_note')} canMessage={d.commands.includes('send_message')} onDone={done} />
        </div>

        <aside className="min-w-0 space-y-6">
          {d.risk && (
            <section className="space-y-2 rounded-lg border border-border p-4 text-sm">
              <h2 className="font-semibold">Риск: {RISK_RU[d.risk.level]} · {d.risk.score}/100</h2>
              {d.risk.heldAtMedium && <p className="text-xs text-muted-foreground">Высокий балл от одного признака удержан на «среднем».</p>}
              {d.risk.explanations.length === 0 ? (
                <p className="text-muted-foreground">Признаков не найдено.</p>
              ) : (
                <ul className="space-y-1.5">
                  {d.risk.explanations.map((r) => (
                    <li key={r.rule}>
                      <span className="tabular-nums text-muted-foreground">+{r.weight}</span> {r.text}
                      <span className="block text-[11px] text-muted-foreground">
                        {r.basis === 'shop_records' ? 'пробел в данных магазина · ' : ''}
                        {Object.entries(r.facts).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground">
                {d.risk.engineVersion} · политика v{d.risk.policyVersion} · {dateRu(d.risk.evaluatedAt)}. Персональные характеристики не учитываются.
              </p>
            </section>
          )}

          {d.advice && (
            <section className="space-y-2 rounded-lg border border-border p-4 text-sm">
              <h2 className="font-semibold">Недоставка: рекомендация</h2>
              <p>{ADVICE_RU[d.advice.advice]}</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {d.advice.reasons.map((r) => (
                  <li key={r}>{ADVICE_REASON_RU[r]}</li>
                ))}
                {d.advice.conflicts.map((r) => (
                  <li key={r}>противоречие: {r}</li>
                ))}
              </ul>
              <p className="text-xs">Расследование: {INVESTIGATION_RU[c.investigationStatus]} {c.carrierClaimRef && `· претензия ${c.carrierClaimRef}`}</p>
              {d.trackingSnapshot ? (
                <p className="text-xs text-muted-foreground">
                  Последний снимок: {TRACKING_RU[d.trackingSnapshot.status]} · {d.trackingSnapshot.carrier ?? ''} {d.trackingSnapshot.trackingNumber ?? ''} · источник {d.trackingSnapshot.source === 'staff' ? 'сотрудник (с сайта перевозчика)' : d.trackingSnapshot.source} · {dateRu(d.trackingSnapshot.retrievedAt)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Данных отслеживания нет: API перевозчика не подключён — снимок вносит сотрудник.</p>
              )}
              <p className="text-[11px] text-muted-foreground">Рекомендация — подсказка. Решение и причину записывает сотрудник.</p>
            </section>
          )}

          {d.approvals.length > 0 && (
            <section className="space-y-1 rounded-lg border border-border p-4 text-sm">
              <h2 className="font-semibold">Согласования</h2>
              {d.approvals.map((a, i) => (
                <p key={i} className="text-xs">
                  {a.kind === 'second_approval' ? 'Второе' : 'Первое'}: {a.staffLabel} · {chf(a.amountMinor)} · {dateRu(a.createdAt)}
                  {a.note && <span className="block text-muted-foreground">{a.note}</span>}
                </p>
              ))}
            </section>
          )}

          {d.history && (
            <section className="space-y-1 rounded-lg border border-border p-4 text-sm">
              <h2 className="font-semibold">История покупателя</h2>
              <p className="text-xs text-muted-foreground">
                Заказов: {d.history.orders} · оплачено: {chf(d.history.totalSpentMinor)} · заявок: {d.history.cases.length}
              </p>
              {d.history.cases.slice(0, 12).map((h) => (
                <p key={h.id} className="text-xs">
                  {h.id === c.id ? <strong>{h.caseNumber}</strong> : <Link href={`/admin/returns/${h.id}`} className="text-gold hover:underline">{h.caseNumber}</Link>} · {CLAIM_RU[h.claimType as ClaimType]} · {STATE_RU[h.state as CaseState]} · {dateRu(h.createdAt, false)}
                  {h.finding && ` · ${FINDING_RU[h.finding]}`}
                </p>
              ))}
            </section>
          )}

          <section className="space-y-1 rounded-lg border border-border p-4 text-sm">
            <h2 className="font-semibold">Журнал</h2>
            <ol className="max-h-[480px] space-y-1.5 overflow-y-auto text-xs">
              {d.events
                .slice()
                .reverse()
                .map((e) => (
                  <li key={e.id}>
                    <span className="text-muted-foreground">{dateRu(e.createdAt)}</span> · {e.actorLabel} · {e.action}
                    {e.toState && e.toState !== e.fromState && ` → ${STATE_RU[e.toState as CaseState] ?? e.toState}`}
                    {e.reason && <span className="block text-muted-foreground">{e.reason}</span>}
                  </li>
                ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

function RestockButton({ caseId, itemId, version, onDone }: { caseId: string; itemId: string; version: number; onDone: (m?: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <span className="mt-1 block">
      <Button
        busy={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await api(`/api/admin/refunds/cases/${caseId}/actions`, { method: 'POST', json: { command: 'restock', version, itemId } })
            onDone('Возвращено на склад')
          } catch (e) {
            onDone((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Вернуть на склад
      </Button>
    </span>
  )
}

function ReleaseButton({ txId, onDone }: { txId: string; onDone: (m?: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      busy={busy}
      onClick={async () => {
        const reason = window.prompt('Снять резерв? Сначала проверяется, что в Stripe нет этого возврата. Причина:')
        if (!reason) return
        setBusy(true)
        try {
          await api(`/api/admin/refunds/transactions/${txId}/release`, { method: 'POST', json: { reason } })
          onDone('Резерв снят')
        } catch (e) {
          onDone((e as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      Снять резерв
    </Button>
  )
}

function EvidencePanel({ d, onOpen, onDone, canAdd }: { d: Detail; onOpen: (id: string) => void; onDone: (m?: string) => void; canAdd: boolean }) {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<EvidenceKind>('carrier_correspondence')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  async function upload() {
    if (!file) return
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      form.append('title', title)
      const res = await fetch(`/api/admin/refunds/cases/${d.case.id}/evidence`, { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setFile(null)
      setTitle('')
      onDone('Файл добавлен')
    } catch (e) {
      onDone((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-2 rounded-lg border border-border p-4 text-sm">
      <h2 className="font-semibold">Доказательства</h2>
      {d.evidence.length === 0 ? (
        <p className="text-muted-foreground">Нет.</p>
      ) : (
        <ul className="space-y-1.5">
          {d.evidence.map((e) => (
            <li key={e.id} className="text-xs">
              <strong>{EVIDENCE_RU[e.kind]}</strong> · {e.title ?? ''} · источник: {e.source} · {e.recordedByLabel} · наблюдалось {dateRu(e.capturedAt)}
              {e.sha256 && <span className="text-muted-foreground"> · sha256 {e.sha256.slice(0, 10)}…</span>}
              {e.purgedAt ? (
                <span className="text-muted-foreground"> · файл удалён по сроку хранения</span>
              ) : (
                e.hasFile && (
                  <button type="button" onClick={() => onOpen(e.id)} className="ml-2 inline-flex items-center gap-1 text-gold hover:underline">
                    открыть <ExternalLink className="size-3" />
                  </button>
                )
              )}
              {e.kind === 'tracking_snapshot' && <span className="block text-muted-foreground">{TRACKING_RU[(e.data.status as TrackingStatus) ?? 'unknown']} · {String(e.data.carrier ?? '')} {String(e.data.trackingNumber ?? '')}</span>}
              {e.kind === 'order_event' && (
                <span className="block break-words text-muted-foreground">
                  статус заказа: {String(e.data.status ?? '—')} · трек: {String(e.data.trackingNumber ?? 'нет')}
                  {e.data.courier ? ` (${String(e.data.courier)})` : ''} · отправлен: {dateRu(e.data.shippedAt as number | null)} · доставлен:{' '}
                  {dateRu(e.data.deliveredAt as number | null)} · ожидалось до: {dateRu(e.data.expectedDeliveryBy as number | null, false)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <select aria-label="Тип файла" value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)} className={`${inputClass} w-auto`}>
            {EVIDENCE_KINDS.filter((k) => k !== 'tracking_snapshot' && k !== 'order_event').map((k) => (
              <option key={k} value={k}>
                {EVIDENCE_RU[k]}
              </option>
            ))}
          </select>
          <input aria-label="Название" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" className={`${inputClass} w-44`} />
          <input aria-label="Файл" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
          <Button busy={busy} disabled={!file} onClick={() => void upload()}>
            Загрузить
          </Button>
        </div>
      )}
    </section>
  )
}

function Messages({ d, canNote, canMessage, onDone }: { d: Detail; canNote: boolean; canMessage: boolean; onDone: (m?: string) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  async function send(command: 'add_note' | 'send_message') {
    setBusy(command)
    try {
      await api(`/api/admin/refunds/cases/${d.case.id}/actions`, { method: 'POST', json: { command, version: d.case.version, body: text } })
      setText('')
      onDone(command === 'send_message' ? 'Сообщение отправлено покупателю' : 'Заметка сохранена')
    } catch (e) {
      onDone((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="space-y-2 rounded-lg border border-border p-4 text-sm">
      <h2 className="font-semibold">Переписка и заметки</h2>
      <ul className="space-y-2">
        {d.messages.map((m) => (
          <li key={m.id} className={m.visibility === 'internal' ? 'rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-2' : m.authorType === 'customer' ? 'rounded-md bg-muted/30 p-2' : 'rounded-md border border-gold/30 p-2'}>
            <span className="block text-[11px] text-muted-foreground">
              {m.visibility === 'internal' ? 'Внутренняя заметка · ' : m.authorType === 'customer' ? 'Покупатель · ' : 'Покупателю · '}
              {m.authorLabel} · {dateRu(m.createdAt)}
            </span>
            <span className="whitespace-pre-line">{m.body}</span>
          </li>
        ))}
      </ul>
      {(canNote || canMessage) && (
        <div className="space-y-2 border-t border-border pt-3">
          <textarea aria-label="Текст" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} className={inputClass} placeholder="Сообщение покупателю или внутренняя заметка" />
          <div className="flex flex-wrap gap-2">
            {canMessage && (
              <Button tone="primary" busy={busy === 'send_message'} disabled={!text.trim()} onClick={() => void send('send_message')}>
                Отправить покупателю
              </Button>
            )}
            {canNote && (
              <Button busy={busy === 'add_note'} disabled={!text.trim()} onClick={() => void send('add_note')}>
                Сохранить как заметку (покупатель не видит)
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

