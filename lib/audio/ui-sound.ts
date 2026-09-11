/**
 * Synthesised UI sounds for Luxe Vault — no audio files, only the Web Audio
 * API. Two tones: a soft tick on hover and a muffled metallic click on press.
 *
 * Framework-free on purpose. React only needs a thin hook over this (see
 * hooks/use-audio-feedback.ts); everything that decides WHETHER a sound may
 * play lives here, where it can be read in one place.
 *
 * Four browser realities shape the code, and each is handled deliberately:
 *
 *  1. AUTOPLAY POLICY. An AudioContext cannot make sound until the page has
 *     had a real user gesture — a click, key press or tap. Hovering is NOT
 *     one. So the context is created and resumed from genuine gesture events
 *     only, and a hover before that is skipped rather than queued: a burst of
 *     queued ticks firing on the first click would be worse than silence.
 *
 *  2. SCROLLING FIRES MOUSEENTER. Cards scrolling under a motionless cursor
 *     fire hover events, which would tick continuously down a product grid.
 *     A hover sound therefore needs a pointer that has actually MOVED in the
 *     last ~120 ms, and consecutive ticks are throttled so a sweep across a
 *     row of size buttons does not buzz.
 *
 *  3. TOUCH SCREENS EMULATE HOVER. A tap fires mouseenter as well as click,
 *     so a phone would play both sounds on every tap. Hover sounds only exist
 *     for a device with a real hovering pointer — the same gate the
 *     cursor-following light uses.
 *
 *  4. A HARD STOP IS ITSELF A CLICK. Stopping an oscillator mid-cycle is a
 *     waveform discontinuity, heard as a click. Every tone rises over 1.5 ms
 *     and decays exponentially to silence before it stops.
 */

export type ToneSpec = {
  type: OscillatorType
  /** Start and end of the exponential frequency sweep, in Hz. */
  from: number
  to: number
  /** Length of the sweep and of the envelope, in seconds. */
  duration: number
  /** Peak gain of the envelope. */
  gain: number
  /** Low-pass filter — what turns a bright click into a muffled one. */
  lowpass?: { frequency: number; q: number }
}

/**
 * Soft tactile tick: 1200 Hz -> 150 Hz over 12 ms at gain 0.06. A sine, the
 * roundest waveform there is, so at this length it reads as a touch rather
 * than a beep.
 */
export const HOVER_TONE: ToneSpec = {
  type: 'sine',
  from: 1200,
  to: 150,
  duration: 0.012,
  gain: 0.06,
}

/**
 * Deeper, muffled metallic click: 800 Hz -> 100 Hz over 18 ms at gain 0.10.
 * A square wave supplies the metallic odd harmonics; the resonant low-pass
 * takes the edge off them, which is the "muffled" part.
 */
export const CLICK_TONE: ToneSpec = {
  type: 'square',
  from: 800,
  to: 100,
  duration: 0.018,
  gain: 0.1,
  lowpass: { frequency: 1800, q: 3 },
}

/** ±5%, so twenty clicks in a row are twenty slightly different clicks. */
export const VARIANCE = 0.05

/**
 * One randomised copy of a tone. The SAME factor scales both ends of the
 * sweep, so the pitch moves but the shape of the sweep does not.
 */
export function varied(spec: ToneSpec, random: () => number = Math.random): ToneSpec {
  const factor = 1 + (random() * 2 - 1) * VARIANCE
  return { ...spec, from: spec.from * factor, to: spec.to * factor }
}

/** Long enough to avoid a click from a hard start, short enough to stay crisp. */
const ATTACK = 0.0015
/** Exponential ramps cannot reach 0; this is −80 dB, which is silence. */
const FLOOR = 0.0001

/**
 * Builds and schedules one tone.
 *
 * Takes ANY BaseAudioContext and a destination node rather than reaching for
 * the live one. That is what lets the identical graph be rendered into an
 * OfflineAudioContext and measured — its peak, its length, and whether it
 * really ends in silence — instead of trusting the parameters by ear.
 */
export function scheduleTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  spec: ToneSpec,
  when: number = ctx.currentTime,
): void {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()

  osc.type = spec.type
  osc.frequency.setValueAtTime(spec.from, when)
  osc.frequency.exponentialRampToValueAtTime(spec.to, when + spec.duration)

  amp.gain.setValueAtTime(FLOOR, when)
  amp.gain.exponentialRampToValueAtTime(spec.gain, when + ATTACK)
  amp.gain.exponentialRampToValueAtTime(FLOOR, when + spec.duration)

  let filter: BiquadFilterNode | null = null
  if (spec.lowpass) {
    filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(spec.lowpass.frequency, when)
    filter.Q.setValueAtTime(spec.lowpass.q, when)
    osc.connect(filter)
    filter.connect(amp)
  } else {
    osc.connect(amp)
  }
  amp.connect(destination)

  osc.start(when)
  // Stops just after the envelope has reached silence, so the stop itself is
  // inaudible.
  osc.stop(when + spec.duration + 0.005)
  // Free the nodes; a page of hovering would otherwise grow the graph forever.
  osc.onended = () => {
    osc.disconnect()
    filter?.disconnect()
    amp.disconnect()
  }
}

// ---------------------------------------------------------------- setting --

/**
 * The on/off setting, persisted as `soundEnabled` in localStorage and ON by
 * default. A small external store rather than React state: every consumer
 * reads the same value, a toggle anywhere takes effect everywhere at once,
 * and the play functions can check it without subscribing to anything.
 */
const STORAGE_KEY = 'soundEnabled'
const listeners = new Set<() => void>()
let enabled: boolean | null = null
let syncingTabs = false

export function isSoundEnabled(): boolean {
  if (enabled !== null) return enabled
  if (typeof window === 'undefined') return true
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    enabled = true // Storage blocked (private mode) — fall back to the default.
  }
  return enabled
}

/** Applies a new value, whether it came from this tab or from another. */
function apply(next: boolean): void {
  enabled = next
  // Switching off also releases the audio device rather than holding it open
  // for sounds that will never play. Switching back on does NOT resume here:
  // that needs a gesture, and the next one — usually the very click on the
  // toggle — resumes it through unlock().
  if (!next && context && context.state === 'running') void context.suspend().catch(() => {})
  listeners.forEach((l) => l())
}

export function setSoundEnabled(next: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // Not persisting is acceptable; the choice still holds for this visit.
  }
  apply(next)
}

/** Flips the setting and returns the new value. */
export function toggleSound(): boolean {
  const next = !isSoundEnabled()
  setSoundEnabled(next)
  return next
}

/** For useSyncExternalStore. Also keeps other open tabs in step. */
export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener)
  if (!syncingTabs && typeof window !== 'undefined') {
    syncingTabs = true
    window.addEventListener('storage', (e) => {
      // A null key is localStorage.clear(), which resets to the default.
      if (e.key !== null && e.key !== STORAGE_KEY) return
      apply(e.newValue !== 'false')
    })
  }
  return () => {
    listeners.delete(listener)
  }
}

// ---------------------------------------------------------------- context --

type AudioContextCtor = typeof AudioContext
type ActivationNavigator = Navigator & { userActivation?: { isActive: boolean } }

let context: AudioContext | null = null
/** The latest resume request, so the first click can wait for it. */
let resuming: Promise<boolean> | null = null
let armed = false
let lastPointerMove = 0
let lastHover = 0
let hoverQuery: MediaQueryList | null | undefined

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** Read live rather than cached: plugging a mouse into a tablet changes it. */
function canHover(): boolean {
  if (hoverQuery === undefined) {
    hoverQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(hover: hover) and (pointer: fine)')
        : null
  }
  return hoverQuery !== null && hoverQuery.matches
}

/**
 * Whether the page is inside a user gesture right now. Asked of the browser
 * where it can answer (navigator.userActivation); elsewhere the event
 * filtering in onGesture is the only guard.
 */
function hasActivation(): boolean {
  const ua = (navigator as ActivationNavigator).userActivation
  return ua ? ua.isActive : true
}

/**
 * Creates and/or resumes the context. Only ever acts inside a real user
 * gesture, the one moment browsers let audio start — trying earlier just logs
 * an autoplay warning and leaves a suspended context behind.
 */
function unlock(): void {
  if (!isSoundEnabled() || !hasActivation()) return
  const Ctor = audioContextCtor()
  if (!Ctor) return
  if (!context) {
    try {
      context = new Ctor({ latencyHint: 'interactive' })
    } catch {
      return
    }
  }
  if (context.state === 'running') return
  // Asks again on every gesture, even with a request already pending: one
  // that was not granted can sit unanswered (Safari), and only a fresh one
  // from inside a gesture is sure to be. The same path brings back a context
  // the OS suspended later — an iOS call, a headphone change — and one that
  // was suspended because sound was switched off.
  const ctx = context
  const attempt = ctx.resume().then(
    () => ctx.state === 'running',
    () => false,
  )
  resuming = attempt
  void attempt.then(() => {
    if (resuming === attempt) resuming = null
  })
}

/**
 * Filters to exactly the HTML spec's activation-triggering input events:
 * pointerdown only for a mouse, pointerup only for touch and pen, touchend,
 * keydown. Anything else — a finger's pointerdown, say — would create the
 * context before the browser allows it.
 */
function onGesture(e: Event): void {
  if (e.type === 'pointerdown' && (e as PointerEvent).pointerType !== 'mouse') return
  if (e.type === 'pointerup' && (e as PointerEvent).pointerType === 'mouse') return
  unlock()
}

/**
 * Installs the gesture and pointer listeners, once. Called when the first
 * component using the hook mounts, so the listeners are in place BEFORE the
 * first click — otherwise that click would arrive with no context to play on.
 * Capture phase and passive: this never interferes with the page's handling.
 */
export function armAudio(): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  const gesture = { capture: true, passive: true } as const
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    window.addEventListener(type, onGesture, gesture)
  }
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'mouse') lastPointerMove = performance.now()
    },
    { passive: true },
  )
}

function running(): AudioContext | null {
  return context && context.state === 'running' ? context : null
}

/** Soft tick for hover. Silently does nothing whenever it should not play. */
export function playHoverSound(): void {
  if (!isSoundEnabled() || !canHover()) return
  const now = performance.now()
  if (now - lastPointerMove > 120) return // the content moved, the pointer did not
  if (now - lastHover < 45) return // sweeping across a row of buttons
  const ctx = running()
  if (!ctx) return // never queue a hover — see note 1 above
  lastHover = now
  scheduleTone(ctx, ctx.destination, varied(HOVER_TONE))
}

/**
 * Muffled click for presses. Call it from the click handler itself — that is
 * what makes the very first press of a visit audible too.
 */
export function playClickSound(): void {
  if (!isSoundEnabled()) return
  const ctx = running()
  if (ctx) {
    scheduleTone(ctx, ctx.destination, varied(CLICK_TONE))
    return
  }
  // Not running yet: normally the first press on the page, whose pointerdown
  // has only just asked the context to start. A click handler runs inside a
  // gesture too, so ask (again) and play the moment it is granted.
  unlock()
  const pending = resuming
  if (!pending) return
  void pending.then((ok) => {
    const live = ok ? running() : null
    if (live && isSoundEnabled()) scheduleTone(live, live.destination, varied(CLICK_TONE))
  })
}
