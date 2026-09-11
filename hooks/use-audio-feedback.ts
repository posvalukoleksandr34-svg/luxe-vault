'use client'

import { useEffect, useSyncExternalStore } from 'react'
import {
  armAudio,
  isSoundEnabled,
  playClickSound,
  playHoverSound,
  setSoundEnabled,
  subscribeSound,
  toggleSound,
} from '@/lib/audio/ui-sound'

/**
 * UI sound feedback for a component.
 *
 *   const { playHoverSound, playClickSound } = useAudioFeedback()
 *
 *   <button onMouseEnter={playHoverSound} onClick={() => { playClickSound(); save() }}>
 *
 * Both functions are module-level, so they are stable: pass them straight to
 * event props, no useCallback needed. Both are safe to call at any moment —
 * before the first click, with sound switched off, on a phone, during SSR —
 * and simply stay silent whenever they should.
 *
 * Mounting the hook arms the engine: it installs the listeners that create
 * and resume the AudioContext on the visitor's first real gesture. That
 * happens once per page, whichever component gets there first.
 */
const FEEDBACK = { playHoverSound, playClickSound } as const

export function useAudioFeedback() {
  useEffect(() => {
    armAudio()
  }, [])
  return FEEDBACK
}

/**
 * The on/off setting, for a settings control. Re-renders when it changes
 * anywhere: this component, another one, or another open tab.
 *
 * The server cannot read localStorage, so it renders the default (on) and
 * React switches to the stored value straight after hydration — without a
 * hydration mismatch, which is what useSyncExternalStore's server snapshot
 * is for.
 */
export function useSoundSetting() {
  const soundEnabled = useSyncExternalStore(subscribeSound, isSoundEnabled, serverSnapshot)
  return { soundEnabled, setSoundEnabled, toggleSound }
}

function serverSnapshot(): boolean {
  return true
}

/** The same controller outside React: read, set, or flip the setting. */
export { isSoundEnabled, setSoundEnabled, toggleSound }
