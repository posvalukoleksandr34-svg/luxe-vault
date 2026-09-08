'use client'

import { Check, Loader2, MapPin, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CountrySelect } from '@/components/country-select'
import { DEFAULT_COUNTRY } from '@/components/phone-input'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The customer's saved addresses.
 *
 * Replaces the localStorage-only copy for signed-in customers: that one lived
 * on a single browser, so an address typed on a laptop did not exist on a
 * phone and disappeared when site data was cleared. The local copy stays as
 * the guest fallback — see lib/saved-profile.ts.
 *
 * Every read and write goes through /api/account/addresses, which queries as
 * the signed-in user so RLS decides what is visible. This component never sees
 * anything the database would not hand the customer directly.
 */

export type SavedAddress = {
  id: string
  label?: string
  name: string
  phone: string
  street: string
  postalCode: string
  city: string
  country: string
  isDefault: boolean
}

const EMPTY = {
  label: '',
  name: '',
  phone: '',
  street: '',
  postalCode: '',
  city: '',
  country: DEFAULT_COUNTRY as string,
}

export function SavedAddresses() {
  const { t, pushToast } = useStore()

  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/account/addresses')
      if (!res.ok) {
        setAddresses([])
        return
      }
      const data = await res.json()
      setAddresses(data.addresses ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/account/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The server's own wording — it says which field is wrong.
        setError(data.error || t('address.saveFailed'))
        return
      }
      setForm(EMPTY)
      setAdding(false)
      pushToast({ title: t('address.saved'), variant: 'success' })
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function makeDefault(id: string) {
    setBusyId(id)
    try {
      await fetch('/api/account/addresses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isDefault: true }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      await fetch(`/api/account/addresses?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="card-gold p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-base font-medium text-foreground">
          {t('address.title')}
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-gold transition hover:text-gold/80"
          >
            <Plus className="size-3.5" />
            {t('address.add')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-4 animate-spin text-gold" />
        </div>
      ) : (
        <>
          {addresses.length === 0 && !adding && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <MapPin className="size-6 text-muted-foreground/30" strokeWidth={1.25} />
              <p className="text-[12px] font-light text-muted-foreground">
                {t('address.empty')}
              </p>
            </div>
          )}

          <ul className="space-y-2">
            {addresses.map((a) => (
              <li
                key={a.id}
                className={cn(
                  'border p-3 transition-colors',
                  a.isDefault ? 'border-gold/40 bg-gold/[0.04]' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] text-foreground">
                      {a.label || a.name}
                      {a.isDefault && (
                        <span className="text-[9px] uppercase tracking-[0.15em] text-gold">
                          {t('address.default')}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[11px] font-light leading-relaxed text-muted-foreground">
                      {a.street}, {a.postalCode} {a.city}, {a.country}
                    </p>
                    <p className="mt-0.5 text-[11px] font-light tabular-nums text-muted-foreground/70">
                      {a.phone}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {!a.isDefault && (
                      <button
                        type="button"
                        onClick={() => makeDefault(a.id)}
                        disabled={busyId === a.id}
                        aria-label={t('address.makeDefault')}
                        title={t('address.makeDefault')}
                        className="flex size-7 items-center justify-center text-muted-foreground/60 transition hover:text-gold disabled:opacity-40"
                      >
                        <Check className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      disabled={busyId === a.id}
                      aria-label={t('address.remove')}
                      title={t('address.remove')}
                      className="flex size-7 items-center justify-center text-muted-foreground/60 transition hover:text-destructive disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {adding && (
            <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
              <Field
                value={form.label}
                onChange={(v) => setForm({ ...form, label: v })}
                placeholder={t('address.label')}
              />
              <Field
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                placeholder={t('checkout.name')}
              />
              <Field
                value={form.phone}
                onChange={(v) => setForm({ ...form, phone: v })}
                placeholder={t('checkout.phone')}
              />
              <Field
                value={form.street}
                onChange={(v) => setForm({ ...form, street: v })}
                placeholder={t('checkout.street')}
              />
              <div className="flex gap-2">
                <Field
                  value={form.postalCode}
                  onChange={(v) => setForm({ ...form, postalCode: v })}
                  placeholder={t('checkout.postalCode')}
                  className="w-1/3"
                />
                <Field
                  value={form.city}
                  onChange={(v) => setForm({ ...form, city: v })}
                  placeholder={t('checkout.city')}
                  className="flex-1"
                />
              </div>
              <CountrySelect
                value={form.country}
                onChange={(v) => setForm({ ...form, country: v })}
              />

              {error && (
                <p role="alert" className="text-[11px] text-destructive">
                  {error}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false)
                    setError(null)
                    setForm(EMPTY)
                  }}
                  className="border border-border px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition hover:text-foreground"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 border border-gold/40 bg-gold/5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:opacity-50"
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  {t('address.save')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Field({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn(
        'w-full border border-border bg-background px-3 py-2.5 text-[12px] text-foreground outline-none transition focus:border-gold',
        className,
      )}
    />
  )
}
