'use client'

import { Check, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function ToastViewport() {
  const { toasts, dismissToast } = useStore()

  return (
    // Bottom-left: the bottom-right corner belongs to the concierge widget.
    <div className="pointer-events-none fixed bottom-5 left-5 z-[200] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'animate-fade-up pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover/95 p-4 shadow-2xl backdrop-blur-md',
            toast.variant === 'gold' && 'border-gold/40 shadow-gold',
            toast.variant === 'success' && 'border-emerald-500/40',
            toast.variant === 'default' && 'border-border',
          )}
        >
          {toast.variant === 'success' && (
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="size-3.5 text-emerald-400" />
            </div>
          )}
          {toast.variant === 'gold' && (
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold/20">
              <Check className="size-3.5 text-gold" />
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
            className="text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
