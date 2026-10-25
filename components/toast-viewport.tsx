'use client'

import { AlertCircle, Check, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function ToastViewport() {
  const { toasts, dismissToast, t } = useStore()

  return (
    // Bottom right from sm up: the bottom-left corner belongs to the support
    // launcher and its chat (support-widget.tsx). On a phone, full width.
    // A polite live region, so a screen reader hears "saved" or "failed"
    // without the focus moving; an error is announced at once (role=alert).
    <div
      aria-live="polite"
      data-vt-chrome="toasts"
      className="pointer-events-none fixed bottom-5 left-5 right-5 z-[200] flex flex-col items-start gap-2 sm:left-auto sm:max-w-md sm:items-end"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          className={cn(
            'animate-fade-up pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover/95 p-4 shadow-2xl backdrop-blur-md',
            toast.variant === 'gold' && 'border-gold/40 shadow-gold',
            toast.variant === 'success' && 'border-emerald-500/40',
            toast.variant === 'error' && 'border-red-500/50',
            (toast.variant === 'default' || !toast.variant) && 'border-border',
          )}
        >
          {toast.variant === 'success' && (
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="size-3.5 text-emerald-700" aria-hidden />
            </div>
          )}
          {toast.variant === 'error' && (
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red-500/15">
              <AlertCircle className="size-3.5 text-red-700" aria-hidden />
            </div>
          )}
          {toast.variant === 'gold' && (
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold/20">
              <Check className="size-3.5 text-gold" aria-hidden />
            </div>
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{toast.title}</p>
            {toast.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {toast.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label={t('product.close')}
            className="text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}
