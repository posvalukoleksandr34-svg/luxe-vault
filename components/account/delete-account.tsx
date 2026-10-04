'use client'

import { Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { clearSavedProfile } from '@/lib/saved-profile'
import { useStore } from '@/lib/store'

/**
 * "Delete my account" — erasure without writing in for it
 * (app/api/account/delete). Says plainly what is deleted and what is kept,
 * and asks for the account's email address as the confirmation: deletion
 * cannot be undone. Not hidden and not dressed up — the same weight as the
 * other settings.
 */
export function DeleteAccount() {
  const { t, currentUser } = useStore()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputId = useId()

  const matches = Boolean(currentUser?.email) && typed.trim().toLowerCase() === currentUser!.email.trim().toLowerCase()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!matches || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: typed.trim() }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error === 'CONFIRMATION_MISMATCH' ? t('acct.deleteMismatch') : t('acct.deleteFailed'))
        setBusy(false)
        return
      }
      // Details remembered in this browser for checkout go with the account.
      clearSavedProfile()
      window.location.assign('/?account=deleted')
    } catch {
      setError(t('acct.deleteFailed'))
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center text-[13px] font-light text-foreground/80 underline decoration-foreground/30 underline-offset-[6px] transition-colors hover:text-foreground hover:decoration-destructive"
      >
        {t('acct.deleteButton')}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-destructive/30 p-4">
      <p className="text-[13px] font-light leading-relaxed text-foreground/80">{t('acct.deleteExplain')}</p>
      <div>
        <label htmlFor={inputId} className="mb-2 block text-[12px] font-light text-foreground/80">
          {t('acct.deleteConfirmLabel')}
        </label>
        <input
          id={inputId}
          type="email"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full rounded-xl border border-border bg-transparent px-4 py-3 text-[14px] font-light text-foreground outline-none transition-colors focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40"
        />
      </div>
      {error && (
        <p role="alert" className="text-[12px] font-light text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!matches || busy}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-destructive px-5 text-[11px] uppercase tracking-[0.15em] text-destructive transition-colors enabled:hover:bg-destructive enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
          {t('acct.deleteConfirm')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setTyped('')
            setError('')
          }}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('acct.deleteCancel')}
        </button>
      </div>
    </form>
  )
}
