'use client'

import { Bookmark, Check, Loader2, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SaveLookAuthDialog } from '@/components/stylist/save-look-dialog'
import dynamic from 'next/dynamic'
import { useAudioFeedback } from '@/hooks/use-audio-feedback'
import { capsuleUrl, rememberLook } from '@/lib/saved-looks'
import { canShareNatively, shareNatively } from '@/lib/share'
import { useStore } from '@/lib/store'
import { matchScore } from '@/lib/stylist/match'
import type { Look, StylistBrief } from '@/lib/stylist/types'

// Mounted only once a capsule has been saved and shared (see below), so its
// code loads then rather than with the stylist page.
const ShareDialog = dynamic(
  () => import('@/components/stylist/share-dialog').then((m) => m.ShareDialog),
  { ssr: false },
)

/**
 * A saved_looks row this component knows about, and whose it is:
 *  - a user id: saved while that customer was signed in — it is in their list;
 *  - null: created by a guest (a guest's Share still needs a row for its link);
 *  - undefined: arrived from a share link, so the owner is not ours to know.
 */
type SavedRow = { id: string; owner: string | null | undefined }

/**
 * "Save look" and "Share capsule".
 *
 * SAVE belongs to an account. A signed-out visitor gets an invitation to sign
 * in rather than a silent anonymous save they could never find again, and the
 * intent is kept: the look is saved the moment a session appears, so signing
 * in from that prompt really does finish the job.
 *
 * SHARE works for anyone — a link has to open for whoever receives it — and
 * reuses whatever row already exists, so Share after Save does not mint a
 * second capsule, nor does pressing Share twice.
 *
 * The two meet in one case that matters: a row created by a guest's Share, or
 * someone else's capsule opened from a link, does not belong to the customer
 * who then presses Save. Reusing its id would report "saved" for a look that
 * never appears in their Saved Looks — so Save creates their own row instead.
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
   *  saved-look cards show. A shared capsule has no brief and gets no score. */
  brief?: StylistBrief
}) {
  const { t, pushToast, currentUser, panel, openAuth } = useStore()
  const { playClickSound } = useAudioFeedback()
  const [saved, setSaved] = useState<SavedRow | null>(
    initialId ? { id: initialId, owner: undefined } : null,
  )
  const [busy, setBusy] = useState<'save' | 'share' | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [authPrompt, setAuthPrompt] = useState(false)
  /** "Save" was pressed while signed out and the visitor chose to sign in. */
  const [pendingSave, setPendingSave] = useState(false)

  /**
   * A row id to act on.
   *
   * `forAccount`: this is a Save, so only a row owned by the signed-in
   * customer will do. A Share takes any row, because a link is a link.
   */
  async function ensureSaved(forAccount: boolean): Promise<string | null> {
    const me = currentUser?.id ?? null
    if (saved && (!forAccount || (me !== null && saved.owner === me))) return saved.id

    const productIds = look.items.map((i) => i.product.id)
    const res = await fetch('/api/looks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The stylist's own words, in the customer's language, go with the
      // pieces — that is what the saved-look card shows under the thumbnails.
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

    // user_id is written from the SESSION on the server, never the body; `me`
    // is the same session as the browser sees it.
    setSaved({ id: data.id, owner: me })
    return data.id
  }

  /** The save itself, for a signed-in customer. */
  async function persist() {
    setBusy('save')
    try {
      const id = await ensureSaved(true)
      if (!id) return
      rememberLook({
        id,
        title: '',
        productIds: look.items.map((i) => i.product.id),
        savedAt: Date.now(),
      })
      setJustSaved(true)
      pushToast({
        title: t('looks.saved'),
        description: t('looks.savedToAccount'),
        variant: 'gold',
      })
    } catch {
      pushToast({ title: t('looks.saveFailed'), variant: 'default' })
    } finally {
      setBusy(null)
    }
  }

  function save() {
    if (busy) return
    // Before anything async, while still inside the click's gesture.
    playClickSound()
    if (!currentUser) {
      setAuthPrompt(true)
      return
    }
    void persist()
  }

  // Read through a ref by the effect below: persist is a new function every
  // render, and the effect must run on the session arriving, not on renders.
  const persistRef = useRef(persist)
  persistRef.current = persist

  /**
   * Finishes a save that was waiting for a sign-in.
   *
   * The account drawer is mounted over this page, so signing in there — or
   * registering and entering the emailed code — sets the session without this
   * component unmounting, and the save completes on its own. If the drawer is
   * closed without signing in, the intent lapses: a save that fires on some
   * later, unrelated sign-in would be a surprise, not a convenience.
   */
  useEffect(() => {
    if (!pendingSave) return
    if (currentUser) {
      setPendingSave(false)
      void persistRef.current()
      return
    }
    if (panel === null) setPendingSave(false)
  }, [pendingSave, currentUser, panel])

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
      const id = await ensureSaved(false)
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

      <SaveLookAuthDialog
        open={authPrompt}
        onOpenChange={setAuthPrompt}
        onChoose={(mode) => {
          setAuthPrompt(false)
          setPendingSave(true)
          openAuth(mode)
        }}
      />

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
