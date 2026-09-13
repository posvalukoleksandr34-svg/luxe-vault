'use client'

import { Wind } from 'lucide-react'
import { useMotionPreference } from '@/lib/motion-preference'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * "Reduce animations" — beside the sound switch in the footer, the same shape
 * and the same semantics: a switch whose name never changes, with the state
 * announced as checked or not.
 *
 * When the device itself asks for reduced motion the switch shows as on and
 * cannot be turned off here — the site never forces motion on someone whose
 * system setting asks for none. It says so on hover and to assistive tech.
 */
export function MotionToggle({ className }: { className?: string }) {
  const { t } = useStore()
  const { reduced, systemReduced, setReduced } = useMotionPreference()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={reduced}
      aria-disabled={systemReduced || undefined}
      title={systemReduced ? t('motion.systemHint') : undefined}
      onClick={() => {
        if (!systemReduced) setReduced(!reduced)
      }}
      className={cn(
        'tap-safe inline-flex items-center gap-1.5 text-[11px] font-light text-muted-foreground/50 transition hover:text-gold',
        systemReduced && 'cursor-default hover:text-muted-foreground/50',
        className,
      )}
    >
      <Wind className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
      {t('motion.label')}
      <span aria-hidden className={reduced ? 'text-gold/70' : undefined}>
        · {reduced ? t('sound.on') : t('sound.off')}
      </span>
    </button>
  )
}
