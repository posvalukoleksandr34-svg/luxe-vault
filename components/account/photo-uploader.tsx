'use client'

import { ImagePlus, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { prepareAttachment } from '@/lib/support/client'
import { cn } from '@/lib/utils'

/**
 * Photographs for a refund request: chosen, downscaled and uploaded one at a
 * time to /api/returns/upload (the private 'returns' bucket, under the
 * customer's own id). The route answers with a PATH; the request carries
 * paths, never files. A photo that failed is shown as failed, never silently
 * dropped from a request the customer thinks contains it.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
export const MAX_PHOTOS = 6

export type Photo = {
  id: string
  preview: string
  status: 'uploading' | 'done' | 'error'
  path?: string
  error?: string
}

export function usePhotoUploads() {
  const { t } = useStore()
  const [photos, setPhotos] = useState<Photo[]>([])
  const previews = useRef<string[]>([])
  useEffect(
    () => () => {
      previews.current.forEach((url) => URL.revokeObjectURL(url))
    },
    [],
  )

  const patch = (id: string, p: Partial<Photo>) => setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)))

  async function add(list: FileList | null) {
    if (!list) return
    const room = MAX_PHOTOS - photos.length
    for (const original of Array.from(list).slice(0, Math.max(0, room))) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const drawable = original.type !== 'image/heic' && original.type !== 'image/heif'
      const preview = drawable ? URL.createObjectURL(original) : ''
      if (preview) previews.current.push(preview)
      setPhotos((prev) => [...prev, { id, preview, status: 'uploading' }])
      if (ACCEPT.split(',').indexOf(original.type) === -1) {
        patch(id, { status: 'error', error: t('rma.photoType') })
        continue
      }
      const file = await prepareAttachment(original)
      if (file.size > MAX_UPLOAD_BYTES) {
        patch(id, { status: 'error', error: t('rma.photoTooLarge') })
        continue
      }
      try {
        const body = new FormData()
        body.append('file', file)
        const res = await fetch('/api/returns/upload', { method: 'POST', body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || typeof data?.path !== 'string') {
          patch(id, {
            status: 'error',
            error: data?.error === 'TOO_LARGE' ? t('rma.photoTooLarge') : data?.error === 'TYPE' ? t('rma.photoType') : t('rma.photoFailed'),
          })
          continue
        }
        patch(id, { status: 'done', path: data.path })
      } catch {
        patch(id, { status: 'error', error: t('rma.photoFailed') })
      }
    }
  }

  function remove(id: string) {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return prev.filter((p) => p.id !== id)
    })
  }

  return {
    photos,
    add,
    remove,
    uploading: photos.some((p) => p.status === 'uploading'),
    paths: photos.filter((p) => p.status === 'done' && p.path).map((p) => p.path!),
  }
}

export function PhotoPicker({ uploads }: { uploads: ReturnType<typeof usePhotoUploads> }) {
  const { t } = useStore()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {uploads.photos.map((photo) => (
          <div
            key={photo.id}
            className={cn(
              'relative size-20 overflow-hidden rounded-xl border bg-muted/30',
              photo.status === 'error' ? 'border-destructive/60' : 'border-border',
            )}
            title={photo.error}
          >
            {photo.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.preview} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground">HEIC</span>
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
              onClick={() => uploads.remove(photo.id)}
              aria-label={t('rma.removePhoto')}
              className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center bg-background/80 text-foreground transition hover:bg-background"
            >
              <X aria-hidden className="size-3" />
            </button>
          </div>
        ))}
        {uploads.photos.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-[10px] uppercase tracking-wider text-muted-foreground transition-colors duration-200 hover:border-gold/50 hover:text-gold"
          >
            <ImagePlus aria-hidden className="size-4" />
            {t('rma.addPhotos')}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void uploads.add(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
