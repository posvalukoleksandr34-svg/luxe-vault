'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * A horizontal wheel picker — a ruler of numbers the customer swipes, with
 * the value under the gold marker in the middle.
 *
 * NATIVE SCROLLING DOES THE PHYSICS. The strip is an ordinary horizontal
 * scroller with CSS scroll-snap (mandatory, centred), so the flick, the
 * momentum and the soft "magnet" onto a number are the platform's own —
 * exactly as a native picker feels, on iOS and Android alike, with no
 * gesture library. Wheel, trackpad and a mouse drag on the strip work too.
 *
 * THE FALLOFF IS NOT REACT. Every visible number is scaled and faded by its
 * distance from the centre on each animation frame, written straight to its
 * style — a scroll must not re-render the dialog sixty times a second. React
 * only hears about a new value when the centred NUMBER changes.
 *
 * STARTS AT 0. The first slot is a "0" that means "not chosen": an empty
 * `value` rests the strip there, drawn muted, and scrolling back onto it
 * clears the value again. The real range (min–max) follows it, so the first
 * swipe to the right lands on `min`. Nothing is reported for the 0 slot — the
 * finder asks the shopper for their own numbers.
 *
 * Slots are addressed by INDEX: 0 is the zero slot, 1 is `min`, `count` is
 * `max`. Accessible as a slider: focusable, arrow keys ±1, Page keys ±10,
 * Home/End, and announced with its value and unit.
 */

type Props = {
  min: number
  max: number
  /** '' until the customer has chosen; otherwise the value as a string. */
  value: string
  onChange: (value: string) => void
  unit: string
  /** Accessible name. */
  label: string
  id?: string
  invalid?: boolean
  describedBy?: string
}

/** Width of one number's slot — the snap step. Wide enough that a
 *  three-digit centre and its enlarged neighbours never touch. */
const ITEM = 58
/** Falloff reaches its floor this many slots from the centre. */
const REACH = 3

export const ScrollPicker = forwardRef<HTMLDivElement, Props>(function ScrollPicker(
  { min, max, value, onChange, unit, label, id, invalid, describedBy },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => scroller.current as HTMLDivElement)

  /** Real values; index 0 is the zero slot before them. */
  const count = max - min + 1
  const clampIndex = (i: number) => Math.min(count, Math.max(0, Math.round(i)))
  const valueAt = (i: number) => (i <= 0 ? 0 : min + i - 1)
  const indexOf = (v: number) => (v < min ? 0 : Math.min(count, Math.round(v) - min + 1))

  const parsed = value.trim() ? Number(value.replace(',', '.')) : NaN
  const isSet = Number.isFinite(parsed) && parsed >= min
  const shownIndex = isSet ? indexOf(parsed) : 0
  const shown = valueAt(shownIndex)

  /** The customer has touched this strip: from now on, scrolling is choosing. */
  const engaged = useRef(false)
  /** Last index reported upward — a prop equal to it needs no re-scroll. */
  const lastEmitted = useRef<number>(shownIndex)
  const lastIndex = useRef(shownIndex)
  const frame = useRef(0)
  /** Where a key press or tap is scrolling to — the base for the next press,
   *  so five quick → presses make five steps even mid-animation. */
  const target = useRef<number | null>(null)
  /** Items styled by the last paint — the ones to reset when the centre jumps. */
  const painted = useRef<Set<number>>(new Set())
  /** Set while a mouse drag moved the strip, so its closing click is ignored. */
  const dragMoved = useRef(false)

  /** Scale and fade every number by its distance from the centre. */
  const paint = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const centre = el.scrollLeft / ITEM
    const items = el.querySelectorAll<HTMLElement>('[data-i]')
    const first = Math.max(0, Math.floor(centre) - REACH - 2)
    const last = Math.min(items.length - 1, Math.ceil(centre) + REACH + 2)
    // A jump (a reset, saved values, End) leaves the old centre far outside
    // this window: put everything painted before and not now back to rest.
    const now = new Set<number>()
    for (let i = first; i <= last; i++) now.add(i)
    painted.current.forEach((i) => {
      if (now.has(i) || !items[i]) return
      const num = items[i].firstElementChild as HTMLElement | null
      if (num) num.style.transform = ''
      items[i].style.opacity = ''
      items[i].dataset.centre = 'false'
    })
    painted.current = now
    for (let i = first; i <= last; i++) {
      const d = Math.min(REACH, Math.abs(i - centre))
      const t = d / REACH // 0 at the centre, 1 at the floor
      const node = items[i]
      const num = node.firstElementChild as HTMLElement | null
      // A steep curve: the centre stands out (×1.75), its neighbours drop
      // quickly (×1.3, then ×1.05) and fade toward the floor.
      if (num) num.style.transform = `scale(${(0.95 + 0.8 * Math.pow(1 - t, 2.2)).toFixed(3)})`
      node.style.opacity = (1 - 0.8 * t).toFixed(3)
      node.dataset.centre = d < 0.5 ? 'true' : 'false'
    }
  }, [])

  /** Puts slot `i` under the marker. */
  const scrollToIndex = useCallback(
    (i: number, smooth: boolean) => {
      const el = scroller.current
      if (!el) return
      const to = clampIndex(i)
      target.current = smooth ? to : null
      el.scrollTo({ left: to * ITEM, behavior: smooth ? 'smooth' : 'auto' })
      paint()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, paint],
  )

  // Follow the value from outside (reset on open, "use my saved
  // measurements") — but not echoes of our own emits, which would fight the
  // finger mid-flick.
  useLayoutEffect(() => {
    if (lastEmitted.current === shownIndex && scroller.current?.dataset.ready) return
    if (!isSet) engaged.current = false
    lastEmitted.current = shownIndex
    lastIndex.current = shownIndex
    scrollToIndex(shownIndex, false)
    if (scroller.current) scroller.current.dataset.ready = 'true'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        paint()
        const index = clampIndex(el.scrollLeft / ITEM)
        if (target.current !== null && index === target.current) target.current = null
        if (index === lastIndex.current || !engaged.current) return
        lastIndex.current = index
        lastEmitted.current = index
        // The zero slot reports "not chosen".
        onChange(index === 0 ? '' : String(valueAt(index)))
        // A detent under the thumb, where the device can give one (Android
        // Chrome; iOS Safari has no web vibration and simply ignores it).
        try {
          navigator.vibrate?.(4)
        } catch {
          // Not allowed here: the visual detent is enough.
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, onChange, paint])

  /** First contact: from here on, the centred slot is the customer's choice. */
  const engage = () => {
    engaged.current = true
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key]
    let next: number | null = null
    if (step !== undefined) next = (target.current ?? shownIndex) + step
    else if (e.key === 'Home') next = 1
    else if (e.key === 'End') next = count
    if (next === null) return
    e.preventDefault()
    engage()
    scrollToIndex(next, true)
  }

  // Mouse drag on desktop: scroll-snap handles touch and wheel, but a mouse
  // has no swipe of its own.
  const drag = useRef<{ x: number; left: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    engage()
    target.current = null
    if (e.pointerType !== 'mouse' || !scroller.current) return
    drag.current = { x: e.clientX, left: scroller.current.scrollLeft }
    dragMoved.current = false
    scroller.current.style.scrollSnapType = 'none'
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !scroller.current) return
    const dx = e.clientX - drag.current.x
    if (Math.abs(dx) > 4) dragMoved.current = true
    scroller.current.scrollLeft = drag.current.left - dx
  }
  const endDrag = () => {
    if (!drag.current || !scroller.current) return
    drag.current = null
    const el = scroller.current
    el.style.scrollSnapType = ''
    scrollToIndex(el.scrollLeft / ITEM, true)
  }

  return (
    <div className="relative select-none">
      {/* The marker: a gold hairline and caret under the chosen number. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-1 left-1/2 z-10 h-4 w-[2px] -translate-x-1/2 rounded-full transition-colors duration-300',
          isSet ? 'bg-gold-gradient' : 'bg-border',
        )}
      />
      <div
        ref={scroller}
        id={id}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={isSet ? shown : undefined}
        aria-valuetext={isSet ? `${shown} ${unit}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={engage}
        onTouchStart={() => {
          engage()
          target.current = null
        }}
        className={cn(
          'scroll-picker flex h-[92px] snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl border bg-card outline-none transition-colors',
          'focus-visible:border-gold focus-visible:ring-4 focus-visible:ring-gold/15',
          invalid ? 'border-destructive' : 'border-border',
          isSet ? 'is-set' : 'is-unset',
        )}
        // width 0 + min-width 100%: the strip is as wide as its container but
        // contributes NOTHING to the container's intrinsic width. Without it a
        // grid parent (the dialog) sized itself to every number in a row —
        // 5,772px — and the marker no longer sat over the middle of the view.
        style={{ touchAction: 'pan-x', width: 0, minWidth: '100%' }}
      >
        {/* Spacers let the first and last numbers reach the centre. */}
        <span aria-hidden className="shrink-0" style={{ width: `calc(50% - ${ITEM / 2}px)` }} />
        {Array.from({ length: count + 1 }, (_, i) => {
          const n = valueAt(i)
          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              aria-hidden
              data-i={i}
              onClick={() => {
                // The click that ends a drag is not a tap on this number.
                if (dragMoved.current) {
                  dragMoved.current = false
                  return
                }
                engage()
                scrollToIndex(i, true)
              }}
              className="scroll-picker__item flex shrink-0 snap-center flex-col items-center justify-center rounded-none"
              style={{ width: ITEM }}
            >
              <span className="scroll-picker__num font-serif text-[15px] leading-none tabular-nums">{n}</span>
              {/* A ruler under the numbers: long every 10, medium every 5; the
                  zero slot stands apart with a long mark of its own. */}
              <span
                className={cn(
                  'mt-3 w-px rounded-full bg-muted-foreground/35',
                  i === 0 || n % 10 === 0 ? 'h-3' : n % 5 === 0 ? 'h-2' : 'h-1.5',
                )}
              />
            </button>
          )
        })}
        <span aria-hidden className="shrink-0" style={{ width: `calc(50% - ${ITEM / 2}px)` }} />
      </div>
      {/* The edges fade into the card, so the strip reads as a drum. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-px left-px w-16 rounded-l-2xl bg-gradient-to-r from-card to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-px right-px w-16 rounded-r-2xl bg-gradient-to-l from-card to-transparent" />
    </div>
  )
})
