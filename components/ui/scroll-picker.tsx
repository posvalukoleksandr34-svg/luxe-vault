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
 * UNSET UNTIL TOUCHED. With `value` empty the strip rests on `restAt`, drawn
 * muted, and reports nothing: the finder asks the shopper for their own
 * numbers, so a resting position must never be mistaken for an answer. The
 * first swipe, tap or key press sets it (and turns the centre gold).
 *
 * Accessible as a slider: focusable, arrow keys ±1, Page keys ±10,
 * Home/End, and announced with its value and unit.
 */

type Props = {
  min: number
  max: number
  /** '' until the customer has chosen; otherwise the value as a string. */
  value: string
  onChange: (value: string) => void
  /** Where an unset strip rests. */
  restAt: number
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
  { min, max, value, onChange, restAt, unit, label, id, invalid, describedBy },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => scroller.current as HTMLDivElement)

  const count = max - min + 1
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)))
  const parsed = value.trim() ? Number(value.replace(',', '.')) : NaN
  const isSet = Number.isFinite(parsed)
  const shown = isSet ? clamp(parsed) : clamp(restAt)

  /** The customer has touched this strip: from now on, scrolling is choosing. */
  const engaged = useRef(false)
  /** Last value reported upward — a prop equal to it needs no re-scroll. */
  const lastEmitted = useRef<number | null>(isSet ? shown : null)
  const lastIndex = useRef(shown - min)
  const frame = useRef(0)
  /** Items styled by the last paint — the ones to reset when the centre jumps. */
  const painted = useRef<Set<number>>(new Set())
  /** Set while a mouse drag moved the strip, so its closing click is ignored. */
  const dragMoved = useRef(false)
  /** Where a key press or tap is scrolling to — the base for the next press,
   *  so five quick → presses make five steps even mid-animation. */
  const target = useRef<number | null>(null)

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

  /** Puts `n` under the marker. */
  const scrollToValue = useCallback(
    (n: number, smooth: boolean) => {
      const el = scroller.current
      if (!el) return
      const to = clamp(n)
      target.current = smooth ? to : null
      el.scrollTo({ left: (to - min) * ITEM, behavior: smooth ? 'smooth' : 'auto' })
      paint()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, paint],
  )

  // Follow the value from outside (reset on open, "use my saved
  // measurements") — but not echoes of our own emits, which would fight the
  // finger mid-flick.
  useLayoutEffect(() => {
    if (isSet && lastEmitted.current === shown) return
    if (!isSet) {
      engaged.current = false
      lastEmitted.current = null
    } else {
      lastEmitted.current = shown
    }
    lastIndex.current = shown - min
    scrollToValue(shown, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        paint()
        const index = Math.round(el.scrollLeft / ITEM)
        if (target.current !== null && min + index === target.current) target.current = null
        if (index === lastIndex.current || !engaged.current) return
        lastIndex.current = index
        const next = clamp(min + index)
        lastEmitted.current = next
        onChange(String(next))
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

  /** First contact: the resting number becomes the chosen one. */
  const engage = () => {
    if (engaged.current) return
    engaged.current = true
    if (!isSet) {
      const current = clamp(min + Math.round((scroller.current?.scrollLeft ?? 0) / ITEM))
      lastEmitted.current = current
      lastIndex.current = current - min
      onChange(String(current))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key]
    let next: number | null = null
    if (step !== undefined) next = (target.current ?? shown) + step
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    if (next === null) return
    e.preventDefault()
    engage()
    scrollToValue(next, true)
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
    scrollToValue(min + Math.round(el.scrollLeft / ITEM), true)
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
        // grid parent (the dialog) sized itself to all 81 numbers in a row —
        // 5,772px — and the marker no longer sat over the middle of the view.
        style={{ touchAction: 'pan-x', width: 0, minWidth: '100%' }}
      >
        {/* Spacers let the first and last numbers reach the centre. */}
        <span aria-hidden className="shrink-0" style={{ width: `calc(50% - ${ITEM / 2}px)` }} />
        {Array.from({ length: count }, (_, i) => {
          const n = min + i
          return (
            <button
              key={n}
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
                scrollToValue(n, true)
              }}
              className="scroll-picker__item flex shrink-0 snap-center flex-col items-center justify-center rounded-none"
              style={{ width: ITEM }}
            >
              <span className="scroll-picker__num font-serif text-[15px] leading-none tabular-nums">{n}</span>
              {/* A ruler under the numbers: long every 10, medium every 5. */}
              <span
                className={cn(
                  'mt-3 w-px rounded-full bg-muted-foreground/35',
                  n % 10 === 0 ? 'h-3' : n % 5 === 0 ? 'h-2' : 'h-1.5',
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
