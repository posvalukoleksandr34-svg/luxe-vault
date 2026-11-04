import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { summarise, type CheckStatus, type ReadinessCheck } from '@/lib/launch-readiness'
import { isAdminRequest } from '@/lib/server/admin-guard'
import { loadLaunchReadiness } from '@/lib/server/launch-readiness'
import { cn } from '@/lib/utils'

// Read on every visit: configuration and backup state change outside the app.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Готовность к запуску',
  robots: { index: false, follow: false },
}

const LABEL: Record<CheckStatus, string> = {
  blocked: 'Блокирует запуск',
  unknown: 'Не удалось проверить',
  owner: 'Решение владельца',
  warning: 'Внимание',
  ok: 'В порядке',
}

const TONE: Record<CheckStatus, string> = {
  blocked: 'border-red-500/40 bg-red-500/10 text-red-800',
  unknown: 'border-amber-500/40 bg-amber-500/10 text-amber-900',
  owner: 'border-sky-600/40 bg-sky-600/10 text-sky-900',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-900',
  ok: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800',
}

/**
 * /admin/launch — what stands between this deployment and taking real orders.
 *
 * Each line is something the application verified for itself (its settings,
 * its database, the record of the backup workflows), or — marked "Решение
 * владельца" — something only the owner, counsel or a provider can settle,
 * which is never shown as done. The references (OA-…) point into
 * OWNER_APPROVAL_CHECKLIST.md.
 */
export default async function AdminLaunchPage() {
  if (!(await isAdminRequest())) redirect('/')
  const checks: ReadinessCheck[] = await loadLaunchReadiness()
  const totals = summarise(checks)
  const gate = checks.find((c) => c.id === 'sales-gate')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Готовность к запуску</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Что приложение проверило само, и что может решить только владелец. Пункт «Решение владельца» здесь никогда
          не отмечается выполненным — подтверждение хранится вне приложения (OWNER_APPROVAL_CHECKLIST.md в репозитории).
        </p>
      </header>

      {gate && (
        <div
          role="status"
          data-testid="launch-gate"
          className={cn('rounded-xl border px-4 py-3 text-sm', gate.status === 'ok' ? TONE.ok : TONE.blocked)}
        >
          <strong className="font-medium">{gate.status === 'ok' ? 'Продажи открыты.' : 'Продажи закрыты.'}</strong> {gate.detail}
        </div>
      )}

      <p className="text-sm text-muted-foreground" data-testid="launch-totals">
        Блокирует: {totals.blocked} · Решение владельца: {totals.owner} · Не проверено: {totals.unknown} · Внимание:{' '}
        {totals.warning} · В порядке: {totals.ok}
      </p>

      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.id} data-check={c.id} data-status={c.status} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-foreground">{c.title}</h2>
              <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', TONE[c.status])}>
                {LABEL[c.status]}
                {c.ref ? ` · ${c.ref}` : ''}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-foreground/90">{c.detail}</p>
            {c.action && <p className="mt-1 text-[13px] text-muted-foreground">{c.action}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
