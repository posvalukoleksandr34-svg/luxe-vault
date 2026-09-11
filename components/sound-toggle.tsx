'use client'

import { Volume2, VolumeX } from 'lucide-react'
import { useAudioFeedback, useSoundSetting } from '@/hooks/use-audio-feedback'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The on/off control for interface sounds. Sits in the footer beside cookie
 * settings — the other "how this site behaves for me" preference.
 *
 * A switch, not a button whose text flips between "on" and "off": its name
 * stays "Interface sounds" and the state is announced as on or off, so no one
 * has to guess whether "Sound off" is the current state or a command. The
 * visible state word is aria-hidden for the same reason — it would otherwise
 * be read twice.
 */
export function SoundToggle({ className }: { className?: string }) {
  const { t } = useStore()
  const { playClickSound } = useAudioFeedback()
  const { soundEnabled, toggleSound } = useSoundSetting()
  const Icon = soundEnabled ? Volume2 : VolumeX

  return (
    <button
      type="button"
      role="switch"
      aria-checked={soundEnabled}
      onClick={() => {
        // Switching ON answers with a click, so the change is heard as well
        // as seen. Switching off is, naturally, silent.
        if (toggleSound()) playClickSound()
      }}
      className={cn(
        'tap-safe inline-flex items-center gap-1.5 text-[11px] font-light text-muted-foreground/50 transition hover:text-gold',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
      {t('sound.label')}
      <span aria-hidden className={soundEnabled ? 'text-gold/70' : undefined}>
        · {soundEnabled ? t('sound.on') : t('sound.off')}
      </span>
    </button>
  )
}
