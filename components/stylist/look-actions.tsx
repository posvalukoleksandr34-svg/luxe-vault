'use client'

import { Bookmark, Check, Loader2, Share2 } from 'lucide-react'
import { useState } from 'react'
import { ShareDialog } from '@/components/stylist/share-dialog'
import { useAudioFeedback } from '@/hooks/use-audio-feedback'
import { capsuleUrl, rememberLook } from '@/lib/saved-looks'
import { canShareNatively, shareNatively } from '@/lib/share'
import { useStore } from '@/lib/store'
import { matchScore } from '@/lib/stylist/match'
import type { Look, StylistBrief } from '@/lib/stylist/types'

/**
 * "Save look" and "Share capsule".
 *
 * Both need the same thing — a saved_looks row — so they share one save and
 * the second press reuses the first's id. Pressing Share after Save does not
 * create a second capsule, and neither does pressing Share twice.
 */
export function LookActions({
  look,
  savedId: initialId,
  brief,
}: {
  look: Look
  savedId?: string
  /** The consultation's answers, when this look came from one. Only used to
   *  record how much of the brief the look matched — the figure the account's
   *  vault cards show. A shared capsule has no brief and gets no score. */
  brief?: StylistBrief
}) {
  const { t, tf, pushToast } = useStore()
  const { playClickSound } = useAudioFeedback()
  const [savedId, setSavedId] = useState<string | null>(initialId ?? null)
  const [busy, setBusy] = useState<'save' | 'share' | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  async function ensureSaved(): Promise<string | null> {
    if (savedId) return savedId

    const productIds = look.items.map((i) => i.product.id)
    const res = await fetch('/api/looks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productIds,
        notes: look.rationale,
        matchScore: brief ? matchScore(look, brief) : null,
      }),
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

  /**
   * Smart share: the OS sheet on a phone, our own modal on a desktop.
   *
   * The capsule has to exist before it can be sent, and saving it is a network
   * round trip — which can outlast the transient user activation that
   * navigator.share requires. When that happens the browser rejects the call
   * (NotAllowedError) rather than opening anything, so 'failed' falls through
   * to the modal and the visitor still gets a link. A second press, with the
   * capsule already saved, reaches the sheet with the gesture intact.
   */
  async function share() {
    if (busy) return
    playClickSound()
    setBusy('share')
    try {
      const id = await ensureSaved()
      if (!id) return
      const url = capsuleUrl(id)

      if (canShareNatively()) {
        const outcome = await shareNatively({
          title: t('looks.capsule'),
          text: t('share.message'),
          url,
        })
        // Sent, or the sheet was opened and dismissed — either way the visitor
        // has answered, and a modal appearing behind the closing sheet would
        // be the app arguing with them.
        if (outcome === 'shared' || outcome === 'dismissed') return
      }

      setShareUrl(url)
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
        {busy === 'share' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Share2 className="size-3.5" />
        )}
        {t('looks.share')}
      </button>

      {/* Mounted only once there is a link to show, so the dialog cannot
          render an empty field before the capsule has been saved. */}
      {shareUrl && (
        <ShareDialog
          url={shareUrl}
          open={shareUrl !== null}
          onOpenChange={(next) => {
            if (!next) setShareUrl(null)
          }}
        />
      )}
    </>
  )
}
