'use client'

import { useEffect, useState } from 'react'
import { FINDING_RU, INSPECTION_RU, INVESTIGATION_RU, RESOLUTION_RU, TRACKING_RU, chf } from '@/lib/refunds/labels-ru'
import { INSPECTION_OUTCOMES, INVESTIGATION_STATUSES, RESOLUTIONS, TRACKING_STATUSES, type Resolution, type TrackingStatus } from '@/lib/refunds/types'
import type { Detail } from './case-view'
import { api, Button, Field, inputClass, parseChf, type Me } from './shared'

/**
 * The form behind each action button. It collects what the command needs and
 * sends { command, version, ...input }; the server decides — amounts are
 * computed there (the preview shows what it will compute), and a staff member
 * may only ask for LESS than the computed amount, with a note to the customer.
 */

type Props = { command: string; detail: Detail; me: Me; onDone: (message?: string) => void; onCancel: () => void }

const REASON_LABEL: Record<string, string> = {
  request_info: 'Вопрос покупателю (он увидит этот текст)',
  reject: 'Причина отказа (покупатель увидит этот текст)',
  cancel: 'Причина закрытия (покупатель увидит этот текст)',
  withdraw_approval: 'Почему одобрение отзывается',
  reopen: 'Почему заявка открывается снова',
  resolve_dispute: 'Чем закончился спор',
  escalate: 'Причина эскалации',
  de_escalate: 'Почему эскалация снята',
  mark_disputed: 'Что известно о споре',
  record_finding: 'На чём основан вывод (не короче 10 символов)',
  record_manual_refund: 'Комментарий к выплате',
}

const SIMPLE = ['start_review', 'mark_return_delivered', 'initiate_refund', 'check_refund', 'reassess_risk', 'authorize_return', 'second_approve']

export function ActionForm({ command, detail, me, onDone, onCancel }: Props) {
  const c = detail.case
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [extra, setExtra] = useState<Record<string, string>>({})
  const set = (k: string, v: string) => setExtra((x) => ({ ...x, [k]: v }))

  async function run(input: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ message?: string; payment?: { status?: string; message?: string } }>(`/api/admin/refunds/cases/${c.id}/actions`, {
        method: 'POST',
        json: { command, version: c.version, ...input },
      })
      onDone(r.message ?? (r.payment?.status ? `Возврат: ${r.payment.status}${r.payment.message ? ` — ${r.payment.message}` : ''}` : 'Готово'))
    } catch (e) {
      const err = e as Error & { body?: { payment?: { message?: string } } }
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const footer = (onSubmit: () => void, disabled = false, label = 'Выполнить', tone: 'primary' | 'danger' = 'primary') => (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button tone={tone} busy={busy} disabled={disabled} onClick={onSubmit}>
        {label}
      </Button>
      <Button onClick={onCancel}>Отмена</Button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  )

  if (command === 'approve') return <ApproveForm detail={detail} busy={busy} error={error} run={run} onCancel={onCancel} />

  if (SIMPLE.includes(command)) {
    const text: Record<string, string> = {
      start_review: 'Взять заявку в работу.',
      mark_return_delivered: 'Перевозчик показывает, что возврат доставлен на склад.',
      initiate_refund: `Отправить в Stripe ${chf((c.approvedAmountMinor ?? 0) - c.refundedAmountMinor)} на исходный способ оплаты. Повтор этой кнопки не создаст второй возврат.`,
      check_refund: 'Спросить у Stripe результат незавершённого возврата и записать его. Новый возврат не создаётся.',
      reassess_risk: 'Пересчитать риск по текущим данным.',
      authorize_return: 'Покупатель получит инструкцию по отправке возврата и срок.',
      second_approve: c.pendingApproval ? `Подтвердить: ${RESOLUTION_RU[c.pendingApproval.resolution]}, ${chf(c.pendingApproval.amountMinor)} (первое согласование: ${c.pendingApproval.byLabel}).` : '',
    }
    return (
      <div className="space-y-2 text-sm">
        <p>{text[command]}</p>
        {(command === 'authorize_return' || command === 'second_approve') && (
          <Field label={command === 'authorize_return' ? 'Дополнительно покупателю (необязательно)' : 'Комментарий (необязательно)'}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} />
          </Field>
        )}
        {footer(() => void run(reason ? { note: reason } : {}), false, command === 'initiate_refund' ? 'Вернуть деньги' : 'Выполнить')}
      </div>
    )
  }

  if (command === 'record_return_shipped') {
    return (
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Field label="Трек-номер возврата">
          <input value={extra.trackingNumber ?? ''} onChange={(e) => set('trackingNumber', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Перевозчик">
          <input value={extra.carrier ?? ''} onChange={(e) => set('carrier', e.target.value)} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">{footer(() => void run({ trackingNumber: extra.trackingNumber, carrier: extra.carrier }), (extra.trackingNumber ?? '').trim().length < 4)}</div>
      </div>
    )
  }

  if (command === 'receive_return') {
    return (
      <div className="space-y-2 text-sm">
        <p>Сколько единиц физически получено:</p>
        {detail.items.map((i) => (
          <label key={i.id} className="flex items-center justify-between gap-3">
            <span>
              {i.name} · {i.size} (заявлено {i.qtyRequested})
            </span>
            <input type="number" min={0} max={i.qtyRequested} value={extra[i.id] ?? String(i.qtyRequested)} onChange={(e) => set(i.id, e.target.value)} className={`${inputClass} w-20`} />
          </label>
        ))}
        {footer(() => void run({ lines: detail.items.map((i) => ({ itemId: i.id, qtyReceived: Number(extra[i.id] ?? i.qtyRequested) })) }))}
      </div>
    )
  }

  if (command === 'record_inspection') {
    return (
      <div className="space-y-3 text-sm">
        {detail.items
          .filter((i) => i.qtyReceived > 0)
          .map((i) => (
            <div key={i.id} className="grid gap-2 sm:grid-cols-[1fr_220px]">
              <span>
                {i.name} · {i.size} (получено {i.qtyReceived})
              </span>
              <select aria-label={`Результат: ${i.name}`} value={extra[`o:${i.id}`] ?? i.inspectionOutcome ?? ''} onChange={(e) => set(`o:${i.id}`, e.target.value)} className={inputClass}>
                <option value="">— результат —</option>
                {INSPECTION_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {INSPECTION_RU[o]}
                  </option>
                ))}
              </select>
              <input aria-label={`Заметка: ${i.name}`} placeholder="Заметка проверки" value={extra[`n:${i.id}`] ?? ''} onChange={(e) => set(`n:${i.id}`, e.target.value)} className={`${inputClass} sm:col-span-2`} />
            </div>
          ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={extra.restock === '1'} onChange={(e) => set('restock', e.target.checked ? '1' : '')} />
          Сразу вернуть принятые единицы на склад
        </label>
        {footer(
          () =>
            void run({
              restock: extra.restock === '1',
              lines: detail.items
                .filter((i) => i.qtyReceived > 0 && (extra[`o:${i.id}`] ?? i.inspectionOutcome))
                .map((i) => ({ itemId: i.id, outcome: extra[`o:${i.id}`] ?? i.inspectionOutcome, note: extra[`n:${i.id}`] ?? '' })),
            }),
          !detail.items.some((i) => i.qtyReceived > 0 && (extra[`o:${i.id}`] ?? i.inspectionOutcome)),
        )}
      </div>
    )
  }

  if (command === 'record_manual_refund') {
    return (
      <div className="space-y-2 text-sm">
        <p>Для оплаты без API (криптовалюта): сначала выплатите {chf((c.approvedAmountMinor ?? 0) - c.refundedAmountMinor)} покупателю, затем запишите реквизиты выплаты.</p>
        <Field label="Реквизиты выплаты (хэш транзакции, номер перевода)">
          <input value={extra.reference ?? ''} onChange={(e) => set('reference', e.target.value)} className={inputClass} />
        </Field>
        <Field label={REASON_LABEL.record_manual_refund}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} />
        </Field>
        {footer(() => void run({ reference: extra.reference, reason }), (extra.reference ?? '').trim().length < 3 || reason.trim().length < 3, 'Записать выплату')}
      </div>
    )
  }

  if (command === 'mark_resolved') {
    return (
      <div className="space-y-2 text-sm">
        <Field label="Трек-номер / номер новой отправки">
          <input value={extra.reference ?? ''} onChange={(e) => set('reference', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Покупателю (необязательно)">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} />
        </Field>
        {footer(() => void run({ reference: extra.reference, note: reason }), (extra.reference ?? '').trim().length < 3)}
      </div>
    )
  }

  if (command === 'assign') {
    return (
      <div className="space-y-2 text-sm">
        <select aria-label="Сотрудник" value={extra.staffId ?? ''} onChange={(e) => set('staffId', e.target.value)} className={inputClass}>
          <option value="">— не назначен —</option>
          {me.choices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {me.mode === 'legacy' && <p className="text-xs text-muted-foreground">Назначать можно только личным учётным записям — их пока нет.</p>}
        {footer(() => void run({ staffId: extra.staffId || null }))}
      </div>
    )
  }

  if (command === 'update_investigation') {
    return (
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Field label="Статус">
          <select value={extra.status ?? c.investigationStatus} onChange={(e) => set('status', e.target.value)} className={inputClass}>
            {INVESTIGATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INVESTIGATION_RU[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Номер претензии у перевозчика">
          <input value={extra.carrierClaimRef ?? c.carrierClaimRef ?? ''} onChange={(e) => set('carrierClaimRef', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Заметка">
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">{footer(() => void run({ status: extra.status ?? c.investigationStatus, carrierClaimRef: extra.carrierClaimRef ?? c.carrierClaimRef ?? '', note: reason }))}</div>
      </div>
    )
  }

  if (command === 'wait_for_delivery') {
    return (
      <div className="space-y-2 text-sm">
        <Field label="Ждать до" hint="После этой даты заявка вернётся к сотруднику.">
          <input type="date" value={extra.until ?? ''} onChange={(e) => set('until', e.target.value)} className={inputClass} />
        </Field>
        {footer(() => void run(extra.until ? { until: Date.parse(`${extra.until}T23:59:00`) } : {}))}
      </div>
    )
  }

  if (command === 'record_finding') {
    return (
      <div className="space-y-2 text-sm">
        <Field label="Вывод" hint="Подтверждённое злоупотребление учитывается в будущих оценках риска — только по задокументированным фактам.">
          <select value={extra.finding ?? ''} onChange={(e) => set('finding', e.target.value)} className={inputClass}>
            <option value="">— выберите —</option>
            {Object.entries(FINDING_RU).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={REASON_LABEL.record_finding}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputClass} />
        </Field>
        {footer(() => void run({ finding: extra.finding, reason }), !extra.finding || reason.trim().length < 10)}
      </div>
    )
  }

  if (command === 'mark_disputed') {
    return (
      <div className="space-y-2 text-sm">
        <Field label="Номер спора (Stripe dp_…)">
          <input value={extra.disputeRef ?? ''} onChange={(e) => set('disputeRef', e.target.value)} className={inputClass} />
        </Field>
        <Field label={REASON_LABEL.mark_disputed}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} />
        </Field>
        {footer(() => void run({ disputeRef: extra.disputeRef, reason }), reason.trim().length < 3)}
      </div>
    )
  }

  if (command === 'record_evidence') return <TrackingForm run={run} busy={busy} error={error} onCancel={onCancel} />

  // Everything else: one reason field.
  const danger = command === 'reject' || command === 'cancel'
  return (
    <div className="space-y-2 text-sm">
      <Field label={REASON_LABEL[command] ?? 'Причина'}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} className={inputClass} />
      </Field>
      {command === 'reject' && (
        <Field label="Внутренняя заметка (покупатель не видит, необязательно)">
          <textarea value={extra.internalNote ?? ''} onChange={(e) => set('internalNote', e.target.value)} rows={2} className={inputClass} />
        </Field>
      )}
      {footer(() => void run({ reason, internalNote: extra.internalNote }), reason.trim().length < 3, 'Выполнить', danger ? 'danger' : 'primary')}
    </div>
  )
}

function ApproveForm({
  detail,
  busy,
  error,
  run,
  onCancel,
}: {
  detail: Detail
  busy: boolean
  error: string | null
  run: (input: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}) {
  const c = detail.case
  const defaultResolution: Resolution = c.requestedResolution
  const [resolution, setResolution] = useState<Resolution>(defaultResolution)
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(detail.items.map((i) => [i.id, defaultResolution === 'return_and_refund' ? i.qtyReceived : i.qtyRequested])),
  )
  const [shipping, setShipping] = useState<'auto' | 'yes' | 'no'>('auto')
  const [postage, setPostage] = useState('')
  const [deduction, setDeduction] = useState('')
  const [deductionReason, setDeductionReason] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [justification, setJustification] = useState('')
  const [preview, setPreview] = useState<{ calc: { totalMinor: number; computedMinor: number; refundableBalanceMinor: number; includesShipping: boolean; itemsMinor: number; shippingMinor: number; warnings: string[] } | null; needsSecondApproval: boolean } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const money = resolution === 'refund' || resolution === 'return_and_refund'

  const lines = detail.items.map((i) => ({ itemId: i.id, qty: qty[i.id] ?? 0 }))
  const input = {
    resolution,
    lines,
    includeShipping: shipping === 'auto' ? undefined : shipping === 'yes',
    returnPostageMinor: parseChf(postage),
    deductionMinor: parseChf(deduction),
    amountMinor: parseChf(amount),
  }
  const key = JSON.stringify(input)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      api<typeof preview>(`/api/admin/refunds/cases/${c.id}/preview`, { method: 'POST', json: JSON.parse(key) })
        .then((p) => live && (setPreview(p), setPreviewError(null)))
        .catch((e: Error) => live && setPreviewError(e.message))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [key, c.id])

  const asked = input.amountMinor
  const highRisk = c.riskLevel === 'high'
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Решение">
          <select value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)} className={inputClass}>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {RESOLUTION_RU[r]}
              </option>
            ))}
          </select>
        </Field>
        {money && (
          <Field label="Доставка в сумме">
            <select value={shipping} onChange={(e) => setShipping(e.target.value as 'auto' | 'yes' | 'no')} className={inputClass}>
              <option value="auto">По политике</option>
              <option value="yes">Вернуть стоимость доставки</option>
              <option value="no">Не возвращать</option>
            </select>
          </Field>
        )}
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-muted-foreground">Количество к одобрению</legend>
        {detail.items.map((i) => (
          <label key={i.id} className="flex items-center justify-between gap-3">
            <span>
              {i.name} · {i.size} <span className="text-xs text-muted-foreground">(заявлено {i.qtyRequested}, получено {i.qtyReceived}{i.inspectionOutcome ? `, ${INSPECTION_RU[i.inspectionOutcome]}` : ''})</span>
            </span>
            <input type="number" min={0} max={i.qtyRequested} value={qty[i.id] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [i.id]: Math.max(0, Math.min(i.qtyRequested, Math.trunc(Number(e.target.value) || 0))) }))} className={`${inputClass} w-20`} />
          </label>
        ))}
      </fieldset>
      {money && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Обратная пересылка, CHF" hint="По квитанции, при браке/нашей ошибке">
            <input inputMode="decimal" value={postage} onChange={(e) => setPostage(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Удержание за потерю стоимости, CHF">
            <input inputMode="decimal" value={deduction} onChange={(e) => setDeduction(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Причина удержания">
            <input value={deductionReason} onChange={(e) => setDeductionReason(e.target.value)} className={inputClass} />
          </Field>
        </div>
      )}
      {money && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          {previewError ? (
            <p className="text-red-700">{previewError}</p>
          ) : preview?.calc ? (
            <p>
              Рассчитано: <strong>{chf(preview.calc.totalMinor)}</strong> (товары {chf(preview.calc.itemsMinor)} + доставка {chf(preview.calc.shippingMinor)}) · можно вернуть по заказу ещё {chf(preview.calc.refundableBalanceMinor)}
              {preview.calc.warnings.length > 0 && <span className="block text-xs text-muted-foreground">{preview.calc.warnings.join(', ')}</span>}
              {preview.needsSecondApproval && <span className="block text-xs text-sky-700">Нужно второе согласование другим сотрудником.</span>}
            </p>
          ) : (
            <p className="text-muted-foreground">Расчёт…</p>
          )}
          <Field label="Сумма к одобрению, CHF (пусто = рассчитанная; можно только меньше)">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </Field>
        </div>
      )}
      <Field label="Покупателю (обязательно, если сумма меньше рассчитанной или есть удержание)">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} />
      </Field>
      <Field label={highRisk ? 'Обоснование (обязательно при высоком риске, от 20 символов)' : 'Внутреннее обоснование (необязательно; обязательно при отступлении от политики)'}>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          busy={busy}
          disabled={(money && asked !== undefined && preview?.calc ? asked > preview.calc.totalMinor : false) || !lines.some((l) => l.qty > 0)}
          onClick={() =>
            void run({
              ...input,
              amountMinor: asked,
              deductionReason,
              note,
              justification,
            })
          }
        >
          Одобрить
        </Button>
        <Button onClick={onCancel}>Отмена</Button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
      <p className="text-xs text-muted-foreground">Одобрение не переводит деньги: после него — отдельная кнопка «Вернуть деньги».</p>
    </div>
  )
}

function TrackingForm({ run, busy, error, onCancel }: { run: (input: Record<string, unknown>) => Promise<void>; busy: boolean; error: string | null; onCancel: () => void }) {
  const [status, setStatus] = useState<TrackingStatus>('in_transit')
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [deliveredAt, setDeliveredAt] = useState('')
  const [signature, setSignature] = useState(false)
  const [note, setNote] = useState('')
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        API перевозчика не подключён: внесите то, что видите на сайте перевозчика. Источник запишется как «сотрудник» со временем просмотра. Не заполняйте то, чего там нет.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Статус у перевозчика">
          <select value={status} onChange={(e) => setStatus(e.target.value as TrackingStatus)} className={inputClass}>
            {TRACKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TRACKING_RU[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Перевозчик">
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Трек-номер">
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Дата доставки (если указана)">
          <input type="date" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={signature} onChange={(e) => setSignature(e.target.checked)} /> Перевозчик указывает подпись получателя
      </label>
      <Field label="Заметка">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          busy={busy}
          onClick={() =>
            void run({
              note,
              snapshot: {
                status,
                carrier: carrier || undefined,
                trackingNumber: tracking || undefined,
                deliveredAt: deliveredAt ? Date.parse(`${deliveredAt}T12:00:00`) : undefined,
                signatureObtained: signature || undefined,
                events: [],
                source: 'staff',
                retrievedAt: Date.now(),
              },
            })
          }
        >
          Записать снимок
        </Button>
        <Button onClick={onCancel}>Отмена</Button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
    </div>
  )
}
