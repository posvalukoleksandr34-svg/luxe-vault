'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CLAIM_RU, RESOLUTION_RU, dateRu } from '@/lib/refunds/labels-ru'
import type { PolicyConfig, RiskRule } from '@/lib/refunds/policy'
import { RULE_EXPLANATION_RU } from '@/lib/refunds/risk'
import { CLAIM_TYPES, RESOLUTIONS, type Resolution } from '@/lib/refunds/types'
import { api, Button, Field, Spinner, inputClass, parseChf, useMe } from './shared'
import { StaffBar } from './staff-bar'
import { cn } from '@/lib/utils'

/**
 * /admin/returns/policy — the refund policy the console applies, versioned:
 * saving writes a NEW version; cases keep the version they were judged under.
 * Defaults follow the published Refund Policy (lib/refunds/policy.ts). Only
 * the owner (policy.manage) can save; everyone else reads.
 */

type PolicyResponse = {
  version: number
  config: PolicyConfig
  defaults: PolicyConfig
  history: { version: number; note?: string; createdAt: number; createdBy: string }[]
}

const WINDOW_LABELS: Record<keyof PolicyConfig['windows'], string> = {
  withdrawalDays: 'Отказ от покупки, дней после доставки',
  faultReportDays: 'Сообщить о браке/ошибке, дней (позже — ручная оценка, не отказ)',
  nonDeliveryReportMaxDays: 'Недоставка: сообщить в течение, дней после отправки',
  deliveryGraceDays: 'Недоставка: запас после ожидаемой даты, дней',
  returnShipmentDays: 'Отправить возврат в течение, дней',
  customerResponseDays: 'Ответ покупателя на запрос, дней',
  appealDays: 'Пересмотр отказа в течение, дней',
}

export function PolicyEditor() {
  const { me, reload, can } = useMe()
  const [data, setData] = useState<PolicyResponse | null>(null)
  const [config, setConfig] = useState<PolicyConfig | null>(null)
  const [second, setSecond] = useState('')
  const [highValue, setHighValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = () =>
    api<PolicyResponse>('/api/admin/refunds/policy')
      .then((d) => {
        setData(d)
        setConfig(structuredClone(d.config))
        setSecond(d.config.approvals.secondApprovalMinor === null ? '' : String(d.config.approvals.secondApprovalMinor / 100))
        setHighValue(String(d.config.risk.highValueMinor / 100))
      })
      .catch((e: Error) => setMessage(e.message))
  useEffect(() => {
    if (me && me.mode !== 'unbound') void load()
  }, [me])

  if (!me) return <Spinner />
  const editable = can('policy.manage')

  function patch(mutate: (c: PolicyConfig) => void) {
    setConfig((c) => {
      if (!c) return c
      const next = structuredClone(c)
      mutate(next)
      return next
    })
  }

  async function save() {
    if (!config || !data) return
    setBusy(true)
    setMessage(null)
    try {
      const out = structuredClone(config)
      out.approvals.secondApprovalMinor = second.trim() === '' ? null : (parseChf(second) ?? null)
      out.risk.highValueMinor = parseChf(highValue) ?? out.risk.highValueMinor
      const r = await api<{ version: number }>('/api/admin/refunds/policy', { method: 'PUT', json: { config: out, basedOn: data.version, note } })
      setMessage(`Сохранено: версия ${r.version}`)
      setNote('')
      await load()
    } catch (e) {
      const err = e as Error & { body?: { issues?: string[] } }
      setMessage(`${err.message}${err.body?.issues ? `: ${err.body.issues.join('; ')}` : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const num = (value: number, onChange: (n: number) => void) => (
    <input type="number" min={0} disabled={!editable} value={value} onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} className={cn(inputClass, 'w-28')} />
  )

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/admin/returns" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Возвраты
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Политика возвратов</h1>
      <StaffBar me={me} onChange={reload} />
      {message && <p className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">{message}</p>}
      {!config || !data ? (
        me.mode !== 'unbound' && <Spinner />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Действует версия {data.version === 0 ? '0 (по умолчанию, из опубликованной Политики возврата)' : data.version}. Новые значения применяются к новым заявкам; уже поданные заявки рассматриваются по своей версии.
            {!editable && ' Изменять может только владелец.'}
          </p>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="font-semibold">Сроки</h2>
            {(Object.keys(WINDOW_LABELS) as (keyof PolicyConfig['windows'])[]).map((k) => (
              <label key={k} className="flex items-center justify-between gap-4">
                <span>{WINDOW_LABELS[k]}</span>
                {num(config.windows[k], (n) => patch((c) => void (c.windows[k] = n)))}
              </label>
            ))}
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="font-semibold">Согласование</h2>
            <Field label="Второе согласование от суммы, CHF (пусто — не требуется)" hint="Требует личных учётных записей: второе согласование даёт другой сотрудник.">
              <input disabled={!editable} inputMode="decimal" value={second} onChange={(e) => setSecond(e.target.value)} className={cn(inputClass, 'w-40')} />
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={!editable} checked={config.approvals.highRiskRequiresJustification} onChange={(e) => patch((c) => void (c.approvals.highRiskRequiresJustification = e.target.checked))} />
              Высокий риск: одобрение только с письменным обоснованием
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={!editable} checked={config.approvals.highRiskRequiresSecondApproval} onChange={(e) => patch((c) => void (c.approvals.highRiskRequiresSecondApproval = e.target.checked))} />
              Высокий риск: требуется второе согласование
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={!editable} checked={config.shipping.refundOnFullWithdrawal} onChange={(e) => patch((c) => void (c.shipping.refundOnFullWithdrawal = e.target.checked))} />
              Возвращать стоимость доставки при отказе от всего заказа
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={!editable} checked={config.shipping.refundOnSellerFault} onChange={(e) => patch((c) => void (c.shipping.refundOnSellerFault = e.target.checked))} />
              Возвращать стоимость доставки при браке/нашей ошибке (весь заказ)
            </label>
          </section>

          <section className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="font-semibold">Типы заявок</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-normal">Тип</th>
                    <th className="font-normal">Включён</th>
                    <th className="font-normal">Нужен возврат товара</th>
                    <th className="font-normal">Мин. фото</th>
                    <th className="text-left font-normal">Решения</th>
                  </tr>
                </thead>
                <tbody>
                  {CLAIM_TYPES.map((t) => {
                    const rule = config.claims[t]
                    return (
                      <tr key={t} className="border-t border-border/60">
                        <td className="py-1.5">{CLAIM_RU[t]}</td>
                        <td className="text-center">
                          <input aria-label={`${CLAIM_RU[t]}: включён`} type="checkbox" disabled={!editable} checked={rule.enabled} onChange={(e) => patch((c) => void (c.claims[t].enabled = e.target.checked))} />
                        </td>
                        <td className="text-center">
                          <input aria-label={`${CLAIM_RU[t]}: возврат товара`} type="checkbox" disabled={!editable} checked={rule.requireReturn} onChange={(e) => patch((c) => void (c.claims[t].requireReturn = e.target.checked))} />
                        </td>
                        <td className="text-center">{num(rule.minPhotos, (n) => patch((c) => void (c.claims[t].minPhotos = Math.min(6, n))))}</td>
                        <td className="py-1.5">
                          {RESOLUTIONS.map((r) => (
                            <label key={r} className="mr-3 inline-flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                disabled={!editable}
                                checked={rule.allowedResolutions.includes(r)}
                                onChange={(e) =>
                                  patch((c) => {
                                    const set = new Set<Resolution>(c.claims[t].allowedResolutions)
                                    if (e.target.checked) set.add(r)
                                    else set.delete(r)
                                    c.claims[t].allowedResolutions = RESOLUTIONS.filter((x) => set.has(x))
                                  })
                                }
                              />
                              {RESOLUTION_RU[r]}
                            </label>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="font-semibold">Невозвратные товары</h2>
            <Field label="Слаги товаров (через запятую)">
              <input disabled={!editable} value={config.restrictions.nonReturnableProductSlugs.join(', ')} onChange={(e) => patch((c) => void (c.restrictions.nonReturnableProductSlugs = e.target.value.split(',').map((x) => x.trim()).filter(Boolean)))} className={inputClass} />
            </Field>
            <Field label="Слаги категорий (через запятую)">
              <input disabled={!editable} value={config.restrictions.nonReturnableCategorySlugs.join(', ')} onChange={(e) => patch((c) => void (c.restrictions.nonReturnableCategorySlugs = e.target.value.split(',').map((x) => x.trim()).filter(Boolean)))} className={inputClass} />
            </Field>
            <Field label="Инструкция по отправке возврата (покупатель видит её после разрешения)">
              <textarea disabled={!editable} rows={4} value={config.returnInstructions} onChange={(e) => patch((c) => void (c.returnInstructions = e.target.value))} className={inputClass} />
            </Field>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="font-semibold">Оценка риска</h2>
            <p className="text-xs text-muted-foreground">
              Риск только сортирует очередь и усиливает проверку; решает человек. Высокий уровень — только при двух и более разных признаках. Персональные характеристики не используются.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center justify-between gap-2">Порог «средний» {num(config.risk.mediumThreshold, (n) => patch((c) => void (c.risk.mediumThreshold = n)))}</label>
              <label className="flex items-center justify-between gap-2">Порог «высокий» {num(config.risk.highThreshold, (n) => patch((c) => void (c.risk.highThreshold = n)))}</label>
              <label className="flex items-center justify-between gap-2">
                Крупная сумма, CHF
                <input disabled={!editable} inputMode="decimal" value={highValue} onChange={(e) => setHighValue(e.target.value)} className={cn(inputClass, 'w-28')} />
              </label>
            </div>
            <table className="w-full">
              <tbody>
                {(Object.keys(config.risk.rules) as RiskRule[]).map((rule) => (
                  <tr key={rule} className="border-t border-border/60">
                    <td className="py-1.5">{RULE_EXPLANATION_RU[rule]}</td>
                    <td className="w-24 text-center">
                      <input aria-label={`${rule}: включено`} type="checkbox" disabled={!editable} checked={config.risk.rules[rule].enabled} onChange={(e) => patch((c) => void (c.risk.rules[rule].enabled = e.target.checked))} />
                    </td>
                    <td className="w-32">{num(config.risk.rules[rule].weight, (n) => patch((c) => void (c.risk.rules[rule].weight = Math.min(40, n))))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="font-semibold">Сроки работы и хранения</h2>
            <label className="flex items-center justify-between gap-4">Решение по заявке, дней (дальше — эскалация) {num(config.sla.decisionDays, (n) => patch((c) => void (c.sla.decisionDays = n)))}</label>
            <label className="flex items-center justify-between gap-4">Хранить файлы закрытых заявок, дней {num(config.retention.evidenceDays, (n) => patch((c) => void (c.retention.evidenceDays = n)))}</label>
          </section>

          {editable && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Что изменено и почему">
                <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputClass, 'w-full sm:w-96')} />
              </Field>
              <Button tone="primary" busy={busy} onClick={() => void save()}>
                Сохранить новую версию
              </Button>
            </div>
          )}

          {data.history.length > 0 && (
            <section className="space-y-1 text-sm">
              <h2 className="font-semibold">История версий</h2>
              {data.history.map((h) => (
                <p key={h.version} className="text-xs text-muted-foreground">
                  v{h.version} · {dateRu(h.createdAt)} · {h.createdBy} {h.note && `— ${h.note}`}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
