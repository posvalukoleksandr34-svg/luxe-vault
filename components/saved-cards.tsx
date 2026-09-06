'use client'

import { CreditCard, Loader2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/lib/store'

type SavedCard = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

/**
 * Saved cards, in the account drawer.
 *
 * Everything shown here is display-only — a brand, an expiry and four digits.
 * The card itself lives at Stripe and is not retrievable through their API by
 * anyone, so nothing on this screen could be used to make a payment. That is
 * the whole reason saved cards are done this way rather than kept in
 * localStorage, where one XSS would expose every customer's card at once.
 */
export function SavedCards() {
  const { t, pushToast } = useStore()
  const [cards, setCards] = useState<SavedCard[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/account/cards')
      const data = await res.json().catch(() => ({}))
      setCards(Array.isArray(data.cards) ? data.cards : [])
    } catch {
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(id: string) {
    if (removing) return
    setRemoving(id)
    try {
      const res = await fetch('/api/account/cards', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error('failed')
      setCards((prev) => prev.filter((c) => c.id !== id))
      pushToast({ title: t('cards.removed'), variant: 'success' })
    } catch {
      pushToast({ title: t('checkout.orderFailed'), variant: 'default' })
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="card-gold p-4">
      <h3 className="mb-3 font-serif text-base font-medium text-foreground">{t('cards.title')}</h3>

      {loading ? (
        <Loader2 className="size-4 animate-spin text-gold/60" />
      ) : cards.length === 0 ? (
        <p className="text-[12px] font-light leading-relaxed text-muted-foreground">
          {t('cards.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex items-center gap-3 border border-border/60 px-3 py-2.5"
            >
              <CreditCard className="size-4 shrink-0 text-gold/70" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-light text-foreground">
                  <span className="uppercase">{card.brand}</span>
                  <span className="mx-1.5 text-muted-foreground/50">••••</span>
                  {card.last4}
                </p>
                <p className="text-[11px] text-muted-foreground/60">
                  {t('cards.expires')} {String(card.expMonth).padStart(2, '0')}/
                  {String(card.expYear).slice(-2)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(card.id)}
                disabled={removing === card.id}
                aria-label={t('cards.remove')}
                title={t('cards.remove')}
                className="flex size-7 shrink-0 items-center justify-center text-muted-foreground/60 transition hover:text-destructive disabled:opacity-40"
              >
                {removing === card.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" strokeWidth={1.5} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
