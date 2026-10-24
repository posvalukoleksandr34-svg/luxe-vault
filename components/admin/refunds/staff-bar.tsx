'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ROLE_RU } from '@/lib/refunds/labels-ru'
import type { StaffRole } from '@/lib/refunds/types'
import { api, Button, inputClass, type Me } from './shared'
import { cn } from '@/lib/utils'

/**
 * Who is working in the console. Staff confirm themselves with their own
 * passphrase after the shared login (lib/server/staff.ts); until they do, the
 * refund console only shows this bar. Legacy mode (no staff created yet)
 * says so, and points at creating them.
 */
export function StaffBar({ me, onChange }: { me: Me; onChange: () => void }) {
  const [staffId, setStaffId] = useState(me.choices[0]?.id ?? '')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function bind() {
    setBusy(true)
    setError(null)
    try {
      await api('/api/admin/refunds/me', { method: 'POST', json: { staffId, passphrase } })
      setPassphrase('')
      onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function unbind() {
    setBusy(true)
    try {
      await api('/api/admin/refunds/me', { method: 'DELETE' })
      onChange()
    } finally {
      setBusy(false)
    }
  }

  if (me.mode === 'legacy') {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-foreground">
        Вы работаете под общим входом (права владельца). Решения записываются как «общий вход», второе согласование
        недоступно. Создайте личные учётные записи в разделе <Link href="/admin/returns/staff" className="text-gold underline">Сотрудники</Link>.
      </div>
    )
  }
  if (me.mode === 'staff' && me.staff) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm">
        <span>
          Вы: <strong>{me.staff.name}</strong> · {ROLE_RU[me.staff.role as StaffRole] ?? me.staff.role}
        </span>
        <Button onClick={() => void unbind()} busy={busy}>
          Сменить сотрудника
        </Button>
      </div>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void bind()
      }}
      className="space-y-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-4 text-sm"
    >
      <p>Кто вы? Решения по возвратам записываются на конкретного сотрудника.</p>
      <div className="flex flex-wrap items-end gap-3">
        <select aria-label="Сотрудник" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={cn(inputClass, 'max-w-[220px]')}>
          {me.choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Личный пароль"
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Личный пароль"
          className={cn(inputClass, 'max-w-[240px]')}
        />
        <Button type="submit" tone="primary" busy={busy} disabled={!staffId || !passphrase}>
          Войти
        </Button>
      </div>
      {error && <p className="text-red-700">{error}</p>}
    </form>
  )
}
