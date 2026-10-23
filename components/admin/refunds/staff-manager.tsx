'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ROLE_RU, dateRu } from '@/lib/refunds/labels-ru'
import { STAFF_ROLES, type StaffRole } from '@/lib/refunds/types'
import { api, Badge, Button, Field, Spinner, inputClass, useMe } from './shared'
import { StaffBar } from './staff-bar'

/**
 * /admin/returns/staff — named staff accounts for the refund console
 * (lib/server/staff.ts). While none exist the shared login acts as the
 * owner; the first account created must be an owner, and then everyone —
 * including that owner — confirms who they are with their own passphrase.
 */

type Member = { id: string; displayName: string; role: StaffRole; active: boolean; lockedUntil?: number; lastSignedInAt?: number; createdAt: number }

const ROLE_HINT: Record<StaffRole, string> = {
  owner: 'всё, включая политику и сотрудников',
  manager: 'решения, выплаты, второе согласование, экспорт',
  agent: 'работа с заявками: вопросы, возвраты товара, проверка; без решений о деньгах',
  viewer: 'только просмотр',
}

export function StaffManager() {
  const { me, reload } = useMe()
  const [staff, setStaff] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState<StaffRole>('owner')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    api<{ staff: Member[] }>('/api/admin/refunds/staff')
      .then((r) => {
        setStaff(r.staff)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    if (me && me.mode !== 'unbound') load()
  }, [me, load])

  async function create() {
    setBusy('create')
    setError(null)
    try {
      await api('/api/admin/refunds/staff', { method: 'POST', json: { displayName: name, role, passphrase } })
      setName('')
      setPassphrase('')
      load()
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function update(id: string, change: Record<string, unknown>) {
    setBusy(id)
    setError(null)
    try {
      await api(`/api/admin/refunds/staff/${id}`, { method: 'PATCH', json: change })
      load()
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!me) return <Spinner />
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/admin/returns" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Возвраты
      </Link>
      <h1 className="font-serif text-2xl font-semibold">Сотрудники</h1>
      <StaffBar me={me} onChange={reload} />
      {error && <p className="text-sm text-red-700">{error}</p>}
      {me.mode !== 'unbound' && !me.permissions.includes('staff.manage') ? (
        <p className="text-sm text-muted-foreground">Управлять сотрудниками может только владелец.</p>
      ) : (
        me.mode !== 'unbound' && (
          <>
            {!staff ? (
              <Spinner />
            ) : staff.length === 0 ? (
              <p className="text-sm text-muted-foreground">Сотрудников пока нет. Первая учётная запись — владелец; после её создания общий вход перестаёт действовать как владелец.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {staff.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="min-w-[160px] flex-1">
                      <strong>{m.displayName}</strong> {!m.active && <Badge>отключён</Badge>} {m.lockedUntil && m.lockedUntil > Date.now() && <Badge tone="red">заблокирован</Badge>}
                      <span className="block text-xs text-muted-foreground">последний вход: {dateRu(m.lastSignedInAt)}</span>
                    </span>
                    <select aria-label={`Роль: ${m.displayName}`} value={m.role} disabled={busy === m.id} onChange={(e) => void update(m.id, { role: e.target.value })} className={`${inputClass} w-auto`}>
                      {STAFF_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_RU[r]}
                        </option>
                      ))}
                    </select>
                    <Button busy={busy === m.id} onClick={() => void update(m.id, { active: !m.active })}>
                      {m.active ? 'Отключить' : 'Включить'}
                    </Button>
                    <Button
                      onClick={() => {
                        const next = window.prompt(`Новый пароль для ${m.displayName} (от 12 символов):`)
                        if (next) void update(m.id, { passphrase: next })
                      }}
                    >
                      Сменить пароль
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <section className="space-y-3 rounded-lg border border-border p-4 text-sm">
              <h2 className="font-semibold">Добавить сотрудника</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Имя">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} />
                </Field>
                <Field label="Роль" hint={ROLE_HINT[role]}>
                  <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={inputClass}>
                    {STAFF_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_RU[r]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Личный пароль (от 12 символов)">
                  <input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className={inputClass} />
                </Field>
              </div>
              <Button tone="primary" busy={busy === 'create'} disabled={name.trim().length < 2 || passphrase.length < 12} onClick={() => void create()}>
                Добавить
              </Button>
            </section>
          </>
        )
      )}
    </div>
  )
}
