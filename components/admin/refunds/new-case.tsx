'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { CLAIM_RU, RESOLUTION_RU, chf } from '@/lib/refunds/labels-ru'
import { CLAIM_TYPES, type ClaimType, type Resolution } from '@/lib/refunds/types'
import { api, Button, Field, inputClass } from './shared'
import { cn } from '@/lib/utils'

/**
 * A case filed by staff for a customer: an order number, then the same
 * choices the customer's form offers — computed by the server for that order.
 * Files are attached on the case page once it exists.
 */

type Lookup = {
  order: { number: string; status: string; paymentStatus?: string; customerName: string; totalMinor: number; refundedMinor: number; guest: boolean }
  lines: { orderItemId: string; name: string; size: string; color: string; qty: number; claimedQty: number }[]
  eligibility: {
    claims: Record<ClaimType, { allowed: boolean; refused?: string; resolutions: Resolution[]; manualReview: string[]; lines: { orderItemId: string; available: number }[] }>
  }
}

export function NewCaseDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [orderNumber, setOrderNumber] = useState('')
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [claim, setClaim] = useState<ClaimType | ''>('')
  const [resolution, setResolution] = useState<Resolution | ''>('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function find() {
    setBusy(true)
    setError(null)
    try {
      setLookup(await api<Lookup>(`/api/admin/refunds/orders/${encodeURIComponent(orderNumber.trim().toUpperCase())}`))
      setClaim('')
      setQty({})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    if (!lookup || !claim || !resolution) return
    setBusy(true)
    setError(null)
    try {
      const lines = Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([orderItemId, n]) => ({ orderItemId, qty: n }))
      const res = await api<{ id: string }>('/api/admin/refunds/cases', {
        method: 'POST',
        json: { orderNumber: lookup.order.number, claimType: claim, resolution, lines, description, photos: [] },
      })
      onCreated(res.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const c = lookup && claim ? lookup.eligibility.claims[claim] : null

  return (
    <div role="dialog" aria-modal="true" aria-label="Новая заявка" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="w-full max-w-xl space-y-4 rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Новая заявка от имени покупателя</h2>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void find()
          }}
          className="flex gap-2"
        >
          <input aria-label="Номер заказа" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="LV-XXXXXX" className={inputClass} />
          <Button type="submit" busy={busy && !lookup} disabled={orderNumber.trim().length < 4}>
            Найти
          </Button>
        </form>

        {lookup && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              {lookup.order.number} · {lookup.order.customerName} {lookup.order.guest && '(гость)'} · {chf(lookup.order.totalMinor)} · возвращено {chf(lookup.order.refundedMinor)}
            </p>
            <Field label="Тип заявки">
              <select
                value={claim}
                onChange={(e) => {
                  const next = e.target.value as ClaimType
                  setClaim(next)
                  setResolution(lookup.eligibility.claims[next]?.resolutions[0] ?? '')
                  setQty({})
                }}
                className={inputClass}
              >
                <option value="">— выберите —</option>
                {CLAIM_TYPES.map((t) => {
                  const e = lookup.eligibility.claims[t]
                  return (
                    <option key={t} value={t} disabled={!e.allowed}>
                      {CLAIM_RU[t]}
                      {!e.allowed ? ` — недоступно (${e.refused})` : e.manualReview.length ? ' — нужна ручная оценка' : ''}
                    </option>
                  )
                })}
              </select>
            </Field>
            {c && (
              <>
                <Field label="Решение, которое просит покупатель">
                  <select value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)} className={inputClass}>
                    {c.resolutions.map((r) => (
                      <option key={r} value={r}>
                        {RESOLUTION_RU[r]}
                      </option>
                    ))}
                  </select>
                </Field>
                <fieldset className="space-y-2">
                  <legend className="text-xs text-muted-foreground">Позиции</legend>
                  {c.lines.map((l) => {
                    const line = lookup.lines.find((x) => x.orderItemId === l.orderItemId)!
                    return (
                      <label key={l.orderItemId} className="flex items-center justify-between gap-3">
                        <span>
                          {line.name} · {line.size} · {line.color} <span className="text-muted-foreground">(доступно {l.available})</span>
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={l.available}
                          value={qty[l.orderItemId] ?? 0}
                          onChange={(e) => setQty((q) => ({ ...q, [l.orderItemId]: Math.max(0, Math.min(l.available, Math.trunc(Number(e.target.value) || 0))) }))}
                          className={cn(inputClass, 'w-20')}
                        />
                      </label>
                    )
                  })}
                </fieldset>
                <Field label="Что сообщил покупатель">
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} className={inputClass} />
                </Field>
              </>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Отмена</Button>
          <Button tone="primary" busy={busy && Boolean(lookup)} disabled={!c || !resolution || !Object.values(qty).some((n) => n > 0)} onClick={() => void create()}>
            Создать заявку
          </Button>
        </div>
      </div>
    </div>
  )
}
