import { armAudio, playClickSound, playFocusSound, playHoverSound } from '@/lib/audio/ui-sound'

/**
 * Site-wide UI sound, by event delegation.
 *
 * Three listeners on the document, not a pair of props on several hundred
 * elements. That is a deliberate architectural choice, for reasons that only
 * show up at this scale:
 *
 *  - COVERAGE. Everything interactive is covered the moment it exists —
 *    including markup this app never wrote: Radix menus, selects, dialogs and
 *    their portals, the calendar, the carousel. Prop-wiring reaches only the
 *    files someone remembered to edit, and every new component starts silent.
 *
 *  - NO RE-RENDERS. Handler props change identity, land in dependency arrays,
 *    and make components re-render for a sound. A document listener costs the
 *    React tree nothing at all.
 *
 *  - IT CANNOT BREAK THE UI. Nothing here touches a component's own handlers,
 *    so no click, no focus trap and no form submission changes behaviour. The
 *    listeners are passive and never call preventDefault or stopPropagation.
 *
 * Components may still wire the hook directly where the intent is worth
 * stating in the code (the stylist's cards, the primary CTAs). Both layers
 * report the same press, and playClickSound is idempotent within 40 ms, so it
 * is heard once.
 *
 * Opt out of a subtree with `data-sound="off"` — used where a control is
 * pressed in rapid bursts and a tick per press would rattle (quantity
 * steppers, gallery arrows).
 */

/**
 * What counts as interactive.
 *
 * Roles as well as tags, because a Radix menu item is a <div role="menuitem">
 * and a Radix select trigger is a <button> that opens a listbox of them —
 * matching on tags alone would miss half of the app's own controls.
 */
const INTERACTIVE = [
  'a[href]',
  'button',
  'summary',
  'select',
  'textarea',
  'input:not([type="hidden"])',
  'label[for]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[data-sound="on"]',
].join(',')

/** The interactive element a raw event target belongs to, or null. */
function control(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null
  const el = target.closest(INTERACTIVE)
  if (!el) return null
  // A press that does nothing should sound like nothing.
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null
  if (el.closest('[data-sound="off"]')) return null
  return el
}

/** The last element hovered, so moving between a button's own children — its
 *  icon, its label — is one tick rather than three. */
let hovered: Element | null = null

function onPointerOver(e: Event): void {
  const pointer = e as PointerEvent
  // Touch and pen emulate a hover on tap; only a mouse really hovers.
  if (pointer.pointerType && pointer.pointerType !== 'mouse') return
  const el = control(pointer.target)
  if (!el || el === hovered) return
  hovered = el
  // The event carries where the pointer is, which is how playHoverSound tells
  // "moved onto this" from "this scrolled under it".
  playHoverSound(pointer)
}

function onPointerOut(e: Event): void {
  // Leaving for something that is not a control clears the memory, so coming
  // back to the same button ticks again.
  if (control((e as PointerEvent).relatedTarget) !== hovered) hovered = null
}

function onFocusIn(e: Event): void {
  const el = control(e.target)
  if (!el) return
  // :focus-visible is exactly "focus the browser would draw a ring around" —
  // i.e. the keyboard. Without it every click would also be a focus, and every
  // press would sound twice.
  try {
    if (!el.matches(':focus-visible')) return
  } catch {
    return // Pseudo-class unsupported: stay silent rather than double up.
  }
  hovered = el
  playFocusSound()
}

function onClick(e: Event): void {
  if (control(e.target)) playClickSound()
}

let running = false

/**
 * Starts the delegated layer and arms the audio engine. Returns a stop
 * function; calling it twice, or starting twice, is harmless.
 */
export function startGlobalFeedback(): () => void {
  if (typeof document === 'undefined' || running) return () => {}
  running = true
  armAudio()

  // Capture phase: a control that stops propagation (menus do) would otherwise
  // be silent. Passive: this can never delay or cancel the interaction itself.
  const opts = { capture: true, passive: true } as const
  document.addEventListener('pointerover', onPointerOver, opts)
  document.addEventListener('pointerout', onPointerOut, opts)
  document.addEventListener('focusin', onFocusIn, opts)
  document.addEventListener('click', onClick, opts)

  return () => {
    running = false
    hovered = null
    document.removeEventListener('pointerover', onPointerOver, opts)
    document.removeEventListener('pointerout', onPointerOut, opts)
    document.removeEventListener('focusin', onFocusIn, opts)
    document.removeEventListener('click', onClick, opts)
  }
}
