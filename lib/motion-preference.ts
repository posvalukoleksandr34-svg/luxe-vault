import { useSyncExternalStore } from 'react'

/**
 * "Reduce animations" — the visitor's choice, on top of the system's.
 *
 * The operating-system setting (prefers-reduced-motion) was already honoured
 * everywhere; this adds a site-level switch for people who want calm here
 * without changing their whole device. Stored in localStorage and reflected
 * as <html data-motion="reduce">, which the global CSS and the few scripted
 * effects (hero, reveal, cursor light) read. The system setting always wins
 * in the direction of LESS motion: the switch can add calm, never force
 * motion on someone whose device asks for none.
 */

export const MOTION_STORAGE_KEY = 'lv.motion'

const listeners = new Set<() => void>()

function systemPrefersReduced(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function reduceChosen(): boolean {
  try {
    return window.localStorage.getItem(MOTION_STORAGE_KEY) === 'reduce'
  } catch {
    return false
  }
}

export function isMotionReduced(): boolean {
  if (typeof window === 'undefined') return false
  return reduceChosen() || systemPrefersReduced()
}

/** Mirrors the preference onto <html>, where CSS can see it. */
export function applyMotionPreference(): void {
  const root = document.documentElement
  if (isMotionReduced()) root.setAttribute('data-motion', 'reduce')
  else root.removeAttribute('data-motion')
}

export function setMotionReduced(reduce: boolean): void {
  try {
    if (reduce) window.localStorage.setItem(MOTION_STORAGE_KEY, 'reduce')
    else window.localStorage.removeItem(MOTION_STORAGE_KEY)
  } catch {
    // Not persisting is acceptable; the choice still holds for this visit.
  }
  applyMotionPreference()
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const system = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const onChange = () => {
    applyMotionPreference()
    listener()
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === MOTION_STORAGE_KEY) onChange()
  }
  system?.addEventListener?.('change', onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    system?.removeEventListener?.('change', onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useMotionPreference() {
  const reduced = useSyncExternalStore(subscribe, isMotionReduced, () => false)
  const systemReduced = useSyncExternalStore(subscribe, systemPrefersReduced, () => false)
  return { reduced, systemReduced, setReduced: setMotionReduced }
}
