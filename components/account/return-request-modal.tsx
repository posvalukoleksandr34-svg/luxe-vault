'use client'

import { AlertCircle, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RETURN_IMAGE_MAX } from '@/lib/returns/schema'
import { useStore } from '@/lib/store'
import { prepareAttachment } from '@/lib/support/client'
import { RETURN_REASONS, type ReturnReason } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { UIKey } from '@/lib/i18n'

/**
 * "Request a return" — the form a customer fills in before anything happens.
 *
 * WHY THIS EXISTS. The button used to file a request in one click, with no
 * reason and no confirmation. Nothing unsafe happened — no money has ever
 * moved from here, and the refund is still an admin's to execute — but a
 * manager was handed "someone wants to return LV-ABC123" and nothing they
 * could act on, so every request became an email exchange to find out what
 * was actually wrong.
 *
 * The three fields are the three things that decision needs: WHY, in the
 * customer's own words if the category is not enough, and their confirmation
 * that the piece is in a state that can be accepted. The checkbox is a
 * condition of the return rather than a formality, which is why the schema
 * (lib/returns/schema.ts) refuses a request without it rather than trusting
 * this component to have disabled the button.
 */

const REASON_LABEL: Record<ReturnReason, UIKey> = {
  wrong_size: 'rma.reason.wrong_size',
  defective: 'rma.reason.defective',
  not_as_described: 'rma.reason.not_as_described',
  changed_mind: 'rma.reason.changed_mind',
  other: 'rma.reason.other',
}

/** What the upload route accepts. HEIC is here because it is what an iPhone
 *  takes; it cannot be downscaled in most browsers, so a very large one may
 *  still be refused for size — with a message, not silently. */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'

/** Matches the route's own ceiling: under the platform's ~4.5 MB body limit. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

type Photo = {
  id: string
  /** A local object URL, for the thumbnail. The bucket is private, so the
   *  server never hands back a URL to show; the browser already has the
   *  pixels. Empty for HEIC, which most browsers cannot draw. */
  preview: string
  status: 'uploading' | 'done' | 'error'
  /** The bucket path once uploaded — what the request actually carries. */
  path?: string
  error?: string
}

/** The order of the list a customer reads, which is not the order the enum
 *  happens to be declared in: the two that are the shop's fault come first. */
const REASON_ORDER: ReturnReason[] = [
  'wrong_size',
  'defective',
  'not_as_described',
  'changed_mind',
  'other',
]

export function ReturnRequestModal({
  orderId,
  open,
  onOpenChange,
  onSubmitted,
}: {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a request is filed, so the list can refresh and show the
   *  pending badge without this component knowing how orders are loaded. */
  onSubmitted: () => void
}) {
  const { t, pushToast } = useStore()

  const [reason, setReason] = useState<ReturnReason>('wrong_size')
  const [comment, setComment] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  // Object URLs hold the image in memory until revoked. Revoked when the
  // dialog goes away, so opening and closing it repeatedly does not leak a
  // phone's worth of photographs.
  const previews = useRef<string[]>([])
  useEffect(
    () => () => {
      previews.current.forEach((url) => URL.revokeObjectURL(url))
    },
    [],
  )

  const uploading = photos.some((p) => p.status === 'uploading')

  function patchPhoto(id: string, patch: Partial<Photo>) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  /**
   * Each photo is downscaled, then uploaded on its own.
   *
   * One at a time, and each in its own request, because the platform refuses
   * bodies above ~4.5 MB and a single phone photo can exceed that. They start
   * uploading the moment they are chosen, so by the time the customer has
   * written their comment the pictures are usually already there.
   */
  async function addFiles(list: FileList | null) {
    if (!list) return
    const room = RETURN_IMAGE_MAX - photos.length
    const chosen = Array.from(list).slice(0, Math.max(0, room))

    for (const original of chosen) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const drawable = original.type !== 'image/heic' && original.type !== 'image/heif'
      const preview = drawable ? URL.createObjectURL(original) : ''
      if (preview) previews.current.push(preview)
      setPhotos((prev) => [...prev, { id, preview, status: 'uploading' }])

      if (ACCEPT.split(',').indexOf(original.type) === -1) {
        patchPhoto(id, { status: 'error', error: t('rma.photoType') })
        continue
      }

      // The same downscaler the support form uses: over ~1.2 MB, redrawn at
      // up to 2000 px, which keeps a seam or a stain perfectly legible.
      const file = await prepareAttachment(original)
      if (file.size > MAX_UPLOAD_BYTES) {
        patchPhoto(id, { status: 'error', error: t('rma.photoTooLarge') })
        continue
      }

      try {
        const body = new FormData()
        body.append('file', file)
        const res = await fetch('/api/returns/upload', { method: 'POST', body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || typeof data?.path !== 'string') {
          const message =
            data?.error === 'TOO_LARGE'
              ? t('rma.photoTooLarge')
              : data?.error === 'TYPE'
                ? t('rma.photoType')
                : t('rma.photoFailed')
          patchPhoto(id, { status: 'error', error: message })
          continue
        }
        patchPhoto(id, { status: 'done', path: data.path })
      } catch {
        patchPhoto(id, { status: 'error', error: t('rma.photoFailed') })
      }
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return prev.filter((p) => p.id !== id)
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    // Never submit while a photo is still on its way: the request would go
    // without it, and the customer would believe it had been attached.
    if (saving || !agreed || uploading) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refund-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          comment: comment.trim(),
          agreed,
          // Only the ones that arrived. A photo that failed is shown as failed
          // in the form; it is not silently dropped from a request the
          // customer thinks contains it.
          images: photos.filter((p) => p.status === 'done' && p.path).map((p) => p.path),
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        // An order that already has an open request is not a failure worth a
        // red message — the list is about to show the pending badge anyway.
        if (data?.error === 'ALREADY_OPEN') {
          onOpenChange(false)
          onSubmitted()
          pushToast({ title: t('rma.alreadyOpen'), variant: 'default' })
          return
        }
        setError(typeof data?.error === 'string' ? data.error : t('orders.cancelFailed'))
        return
      }

      onOpenChange(false)
      onSubmitted()
      pushToast({ title: t('rma.submitted'), description: orderId, variant: 'gold' })
    } catch {
      setError(t('orders.cancelFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('rma.title')}</DialogTitle>
          <DialogDescription>{t('rma.intro')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-6">
          <fieldset>
            <legend className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {t('rma.reason')}
            </legend>
            {/* Radios, not a <select>: five short options are faster to choose
                from when they are all visible, and on a phone a native select
                opens a wheel for what is a one-tap decision. */}
            <div className="mt-3 space-y-1">
              {REASON_ORDER.map((value) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 border px-4 py-3 text-[13px] font-light transition-colors duration-200',
                    reason === value
                      ? 'border-gold/50 bg-gold/5 text-foreground'
                      : 'border-border/60 text-foreground/70 hover:border-gold/30',
                  )}
                >
                  <input
                    type="radio"
                    name="return-reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="size-3.5 accent-gold"
                  />
                  {t(REASON_LABEL[value])}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="rma-comment"
              className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              {t('rma.comment')}
            </label>
            <textarea
              id="rma-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t('rma.commentHint')}
              className="mt-3 w-full resize-none border border-border bg-background px-3.5 py-3 text-[13px] font-light text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-gold"
            />
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {t('rma.photos')}
            </p>
            <p className="mt-1.5 text-[12px] font-light text-muted-foreground/80">{t('rma.photosHint')}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className={cn(
                    'relative size-20 overflow-hidden border bg-muted/30',
                    photo.status === 'error' ? 'border-destructive/60' : 'border-border',
                  )}
                  title={photo.error}
                >
                  {photo.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.preview} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground">
                      HEIC
                    </span>
                  )}

                  {photo.status === 'uploading' && (
                    <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <Loader2 aria-hidden className="size-4 animate-spin text-gold" />
                    </span>
                  )}
                  {photo.status === 'error' && (
                    <span className="absolute inset-x-0 bottom-0 bg-destructive/85 px-1 py-0.5 text-center text-[9px] leading-tight text-white">
                      {photo.error}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    aria-label={t('rma.removePhoto')}
                    className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center bg-background/80 text-foreground transition hover:bg-background"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </div>
              ))}

              {photos.length < RETURN_IMAGE_MAX && (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex size-20 flex-col items-center justify-center gap-1 border border-dashed border-border text-[10px] uppercase tracking-wider text-muted-foreground transition-colors duration-200 hover:border-gold/50 hover:text-gold"
                >
                  <ImagePlus aria-hidden className="size-4" />
                  {t('rma.addPhotos')}
                </button>
              )}
            </div>

            {/* image/* on a phone offers the camera as well as the gallery,
                which is the whole point: the customer is holding the item. */}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                void addFiles(e.target.files)
                // Cleared so choosing the same file again still fires onChange.
                e.target.value = ''
              }}
            />
          </div>

          <label className="flex cursor-pointer items-start gap-3 text-[13px] font-light leading-relaxed text-foreground/80">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-gold"
            />
            {t('rma.confirm')}
          </label>

          {error && (
            <p className="flex items-start gap-2 text-[12px] font-light leading-snug text-destructive">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="tap-safe min-h-[44px] border border-border px-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground transition-colors duration-300 hover:text-foreground"
            >
              {t('rma.cancel')}
            </button>
            {/* Disabled until the box is ticked: the schema refuses it anyway,
                but a customer should see the condition rather than be told
                about it by a validation error after they press submit. */}
            <button
              type="submit"
              disabled={saving || !agreed || uploading}
              title={uploading ? t('rma.photosUploading') : undefined}
              className="tap-safe no-juice inline-flex min-h-[44px] items-center justify-center gap-2 border border-gold bg-gold px-8 text-[11px] uppercase tracking-[0.2em] text-gold-foreground transition-colors duration-300 enabled:hover:bg-transparent enabled:hover:text-gold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw aria-hidden className="size-3.5" />
              )}
              {t('rma.submit')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
