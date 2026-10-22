'use client'

import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/** Small shared pieces of the refund console (Russian, like the console). */

export type Me = {
  mode: 'legacy' | 'staff' | 'unbound'
  staff: { id: string; name: string; role: string } | null
  role: string | null
  label: string | null
  permissions: string[]
  choices: { id: string; name: string }[]
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly body: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    // Staff refusals carry a code in `error` and the sentence in `message`.
    super(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : `HTTP ${status}`)
    this.status = status
    this.code = typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : undefined
    this.body = body
  }
}

/** JSON in, JSON out; a non-2xx answer throws ApiError with the server's message. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError(res.status, body)
  return body as T
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    api<Me>('/api/admin/refunds/me')
      .then((m) => {
        setMe(m)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => reload(), [reload])
  return { me, error, reload, can: (p: string) => Boolean(me?.permissions.includes(p)) }
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn('size-4 animate-spin text-muted-foreground', className)} />
}

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'gold' | 'green' | 'red' | 'amber' | 'blue' }) {
  const tones = {
    muted: 'border-border text-muted-foreground',
    gold: 'border-gold/40 bg-gold/10 text-foreground',
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
    red: 'border-red-500/30 bg-red-500/10 text-red-700',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
    blue: 'border-sky-500/40 bg-sky-500/10 text-sky-700',
  }
  return <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px]', tones[tone])}>{children}</span>
}

export const STATE_TONE: Record<string, 'muted' | 'gold' | 'green' | 'red' | 'amber' | 'blue'> = {
  requested: 'amber',
  under_review: 'amber',
  awaiting_customer_info: 'muted',
  awaiting_return_shipment: 'muted',
  return_in_transit: 'muted',
  return_delivered: 'amber',
  awaiting_inspection: 'amber',
  approved: 'blue',
  refund_processing: 'blue',
  partially_refunded: 'green',
  refunded: 'green',
  resolved: 'green',
  rejected: 'red',
  cancelled: 'muted',
  expired: 'muted',
  disputed: 'red',
}

export const RISK_TONE = { low: 'muted', medium: 'amber', high: 'red' } as const

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground/80">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-gold'

export function Button({
  children,
  onClick,
  disabled,
  busy,
  tone = 'default',
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  busy?: boolean
  tone?: 'default' | 'primary' | 'danger'
  type?: 'button' | 'submit'
}) {
  const tones = {
    default: 'border-border text-foreground hover:border-gold/50',
    primary: 'border-gold bg-gold/10 font-medium text-foreground hover:bg-gold/20',
    danger: 'border-red-500/40 text-red-700 hover:bg-red-500/10',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={cn('inline-flex min-h-[38px] items-center gap-2 rounded-lg border px-3.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40', tones[tone])}
    >
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  )
}

/** CHF typed by a person → integer rappen, or undefined for blank/invalid. */
export function parseChf(value: string): number | undefined {
  const v = value.trim().replace(',', '.')
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) return undefined
  const [whole, frac = ''] = v.split('.')
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2))
}
