'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'

export default function AdminLoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Неверный пароль')
        setLoading(false)
        return
      }
      // Full navigation so the fresh session cookie is present for the
      // middleware check on the very next request.
      window.location.href = '/admin'
    } catch {
      setError('Не удалось выполнить вход')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="animate-fade-in w-full max-w-sm border border-border/60 p-10"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex size-12 items-center justify-center border border-gold/40 text-gold">
            <Lock className="size-5" />
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="font-serif text-lg font-semibold tracking-[0.2em] text-foreground">
              LUXE
            </span>
            <span className="font-serif text-lg font-semibold tracking-[0.2em] text-gold">
              VAULT
            </span>
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">
            Private Access
          </p>
        </div>

        <label className="block">
          <span className="mb-2 block text-[11px] uppercase tracking-[0.15em] text-foreground">
            Пароль
          </span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border border-border bg-background px-3 py-3 text-[13px] font-light text-foreground outline-none transition focus:border-gold/40"
          />
        </label>

        {error && (
          <p className="mt-3 text-[12px] text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          className="mt-6 w-full border border-gold/30 bg-gold/5 py-3.5 text-[12px] uppercase tracking-[0.2em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
        >
          {loading ? '...' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
