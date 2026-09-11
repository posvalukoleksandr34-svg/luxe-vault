'use client'

import { Bookmark, Check, Link2, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useAudioFeedback } from '@/hooks/use-audio-feedback'
import { capsuleUrl, rememberLook } from '@/lib/saved-looks'
import { useStore } from '@/lib/store'
import type { Look } from '@/lib/stylist/types'

/**
 * "Save look" and "Share capsule".
 *
 * Both need the same thing — a saved_looks row — so they share one save and
 * the second press reuses the first's id. Pressing Share after Save does not
 * create a second capsule, and neither does pressing Share twice.
 */
export function LookActions({ look, savedId: initialId }: { look: Look; savedId?: string }) {
  const { t, tf, pushToast } = useStore()
  const { playClickSound } = useAudioFeedback()
  const [savedId, setSavedId] = useState<string | null>(initialId ?? null)
  const [busy, setBusy] = useState<'save' | 'share' | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  async function ensureSaved(): Promise<string | null> {
    if (savedId) return savedId

    const productIds = look.items.map((i) => i.product.id)
    const res = await fetch('/api/looks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds, notes: look.rationale }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok || typeof data.id !== 'string') {
      // "Not set up yet" and "something broke" are different messages: the
      // first is a migration away, the second is worth retrying.
      pushToast({
        title: data.error === 'NOT_CONFIGURED' ? t('looks.notConfigured') : t('looks.saveFailed'),
        variant: 'default',
      })
      return null
    }

    setSavedId(data.id)
    return data.id
  }

  async function save() {
    if (busy) return
    // Before the await, while still inside the click's gesture.
    playClickSound()
    setBusy('save')
    try {
      const id = await ensureSaved()
      if (!id) return
      // Remembered even when the look arrived already saved (a capsule someone
      // shared with you): "save" then means "keep it in my list".
      rememberLook({
        id,
        title: '',
        productIds: look.items.map((i) => i.product.id),
        savedAt: Date.now(),
      })
      setJustSaved(true)
      pushToast({
        title: t('looks.saved'),
        description: tf('looks.savedBody', { url: capsuleUrl(id) }),
        variant: 'gold',
      })
    } catch {
      pushToast({ title: t('looks.saveFailed'), variant: 'default' })
    } finally {
      setBusy(null)
    }
  }

  async function share() {
    if (busy) return
    setBusy('share')
    try {
      const id = await ensureSaved()
      if (!id) return
      const url = capsuleUrl(id)
      try {
        await navigator.clipboard.writeText(url)
        pushToast({ title: t('looks.linkCopied'), description: url, variant: 'gold' })
      } catch {
        // Clipboard refused (insecure origin, browser policy). The link is
        // still the point, so show it where it can be copied by hand.
        pushToast({ title: tf('looks.copyFallback', { url }), variant: 'default' })
      }
    } catch {
      pushToast({ title: t('looks.saveFailed'), variant: 'default' })
    } finally {
      setBusy(null)
    }
  }

  const secondary =
    'inline-flex items-center justify-center gap-2 border border-border/60 px-5 py-4 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition-all duration-300 hover:border-gold/50 hover:text-foreground disabled:opacity-50'

  return (
    <>
      <button type="button" onClick={save} disabled={busy !== null} className={secondary}>
        {busy === 'save' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : justSaved ? (
          <Check className="size-3.5 text-gold" />
        ) : (
          <Bookmark className="size-3.5" />
        )}
        {justSaved ? t('looks.saved') : t('looks.save')}
      </button>
      <button type="button" onClick={share} disabled={busy !== null} className={secondary}>
        {busy === 'share' ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
        {t('looks.share')}
      </button>
    </>
  )
}
