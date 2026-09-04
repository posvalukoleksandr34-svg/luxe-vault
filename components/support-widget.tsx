'use client'

import { LifeBuoy, Mail, Send, X } from 'lucide-react'
import { useState } from 'react'
import { SUPPORT_EMAIL, TELEGRAM_ADMIN } from '@/lib/data'
import { useStore } from '@/lib/store'

/** Floating concierge widget — reachable from anywhere on the site, fixed
 * bottom-right. Opens into a slide-up panel with direct contact info plus a
 * message form backed by /api/support, so every enquiry lands in the admin
 * panel rather than in a mailbox nobody watches. */
export function SupportWidget() {
  const [open, setOpen] = useState(false)
  const { t } = useStore()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('support.title')}
        aria-expanded={open}
        className="group fixed bottom-5 left-5 z-[90] flex items-center gap-2.5 border border-gold/40 bg-background px-4 py-3 text-gold shadow-2xl transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
      >
        {open ? <X className="size-[18px]" /> : <LifeBuoy className="size-[18px]" />}
        <span className="hidden text-[11px] uppercase tracking-[0.2em] sm:inline">
          {t('support.title')}
        </span>
      </button>

      {open && (
        <>
          <div
            className="animate-fade-in fixed inset-0 z-[85] bg-background/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="animate-fade-up fixed bottom-[5.5rem] left-5 z-[90] w-[calc(100vw-2.5rem)] max-w-sm border border-border bg-popover shadow-2xl">
            <SupportPanel onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </>
  )
}

function SupportPanel({ onClose }: { onClose: () => void }) {
  const { t, pushToast } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !message.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }),
      })
      if (!res.ok) throw new Error('failed')
      setSent(true)
      setName('')
      setEmail('')
      setMessage('')
    } catch {
      pushToast({ title: t('support.error'), variant: 'default' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-h-[80vh] overflow-y-auto p-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h3 className="font-serif text-lg font-bold text-foreground">{t('support.title')}</h3>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            {t('support.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground transition hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mb-5 space-y-2 border border-border/60 p-3">
        <a
          href={`https://t.me/${TELEGRAM_ADMIN.replace('@', '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-[12px] text-muted-foreground transition hover:text-gold"
        >
          <Send className="size-3.5" />
          {TELEGRAM_ADMIN}
        </a>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="flex items-center gap-2 text-[12px] text-muted-foreground transition hover:text-gold"
        >
          <Mail className="size-3.5" />
          {SUPPORT_EMAIL}
        </a>
      </div>

      {sent ? (
        <div className="border border-gold/30 bg-gold/5 p-4 text-center">
          <p className="text-[12px] font-light text-gold">{t('support.sent')}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('support.name')}
            required
            maxLength={60}
            className="w-full border border-border bg-background px-3 py-2.5 text-[13px] font-light text-foreground outline-none transition focus:border-gold/40"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('support.email')}
            required
            className="w-full border border-border bg-background px-3 py-2.5 text-[13px] font-light text-foreground outline-none transition focus:border-gold/40"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('support.message')}
            required
            rows={3}
            maxLength={1000}
            className="w-full resize-none border border-border bg-background px-3 py-2.5 text-[13px] font-light text-foreground outline-none transition focus:border-gold/40"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim() || !email.trim() || !message.trim()}
            className="w-full border border-gold/30 bg-gold/5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/40"
          >
            {t('support.send')}
          </button>
        </form>
      )}
    </div>
  )
}
