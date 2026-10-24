'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The console's one confirmation dialog, for actions that cannot be taken
 * back or that reach a customer (deleting, cancelling, discarding edits).
 *
 * Radix underneath: focus moves into the dialog and back, Escape and the
 * backdrop cancel, and a screen reader hears the title and the description.
 * Above the product editor (z-[95]) so it can guard that form's close.
 *
 * Say what will happen, concretely, in `description` / `details` — "Delete?"
 * alone is how the wrong thing gets deleted. Harmless, reversible actions do
 * not need this at all.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'Отмена',
  tone = 'danger',
  busy = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  /** Extra lines under the description: what is affected, what is kept. */
  details?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  busy?: boolean
  onConfirm: () => void
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[120] bg-black/40" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[121] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-6 shadow-2xl focus:outline-none"
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
        >
          <DialogPrimitive.Title className="text-base font-semibold text-foreground">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          {details && <div className="mt-3 text-sm leading-relaxed text-muted-foreground">{details}</div>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                disabled={busy}
                className="min-h-[40px] rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
              >
                {cancelLabel}
              </button>
            </DialogPrimitive.Close>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={cn(
                'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:opacity-60',
                tone === 'danger'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-foreground text-background hover:bg-foreground/90',
              )}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {confirmLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
