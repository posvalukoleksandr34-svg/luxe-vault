'use client'

import { useEffect, useRef } from 'react'

/**
 * Liquid gold that follows the cursor.
 *
 * Three pools of light chase the pointer at three different rates. The fast
 * one arrives almost with the cursor, the slow one lags well behind, and the
 * gap between them is the whole effect: the light stretches when you move
 * quickly and pours back together when you stop. That is what reads as liquid
 * rather than as a circle glued to the mouse.
 *
 * ONE rAF LOOP DRIVES EVERYTHING HERE — the three pools and the cursor ring.
 * Four separate loops would each schedule their own frame and each force their
 * own style flush; one loop writes every transform in a single pass.
 *
 * Nothing animates but `transform` and `opacity`. The gradients are rasterised
 * once and thereafter only moved, so the per-frame cost is a compositor
 * matrix multiply, not a repaint — on a page whose real job is scrolling a
 * grid of photographs.
 *
 * The loop STOPS when there is nothing to do: when every layer has settled
 * within half a pixel of its target, when the tab is hidden, and when the
 * pointer leaves the window. It restarts on the next movement. An idle tab
 * costs nothing.
 *
 * Desktop only, and only for a device that actually has a hovering pointer —
 * on a touchscreen the "cursor" is wherever you last tapped, so the effect is
 * a smear that appears on tap and means nothing.
 */

/** How much of the remaining distance each layer covers per frame. Small
 *  numbers lag further; the spread between them is the stretch. */
const EASE = {
  far: 0.022,
  mid: 0.055,
  core: 0.115,
  ring: 0.19,
} as const

/** Below this, a layer is close enough to its target to stop the loop. */
const SETTLED = 0.4

type Layer = { x: number; y: number; el: HTMLElement | null }

export function PointerAtmosphere() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    // A coarse pointer is a finger, and `hover: none` means the pointer cannot
    // rest anywhere — both make a cursor-following light meaningless. Reduced
    // motion opts out entirely; the static ambient layer still carries the
    // atmosphere for those visitors.
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)')
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!fine?.matches || still?.matches) return

    root.dataset.active = 'true'

    const layers: Record<'far' | 'mid' | 'core' | 'ring', Layer> = {
      far: { x: 0, y: 0, el: root.querySelector('.pa__far') },
      mid: { x: 0, y: 0, el: root.querySelector('.pa__mid') },
      core: { x: 0, y: 0, el: root.querySelector('.pa__core') },
      ring: { x: 0, y: 0, el: root.querySelector('.pa__ring') },
    }

    // Start centred so the first movement pours in from the middle of the
    // screen rather than flying in from the top-left corner.
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    for (const l of Object.values(layers)) {
      l.x = target.x
      l.y = target.y
    }

    let frame = 0
    let running = false
    let seen = false

    function step() {
      running = true
      let moving = false

      for (const key of ['far', 'mid', 'core', 'ring'] as const) {
        const layer = layers[key]
        const ease = EASE[key]
        layer.x += (target.x - layer.x) * ease
        layer.y += (target.y - layer.y) * ease

        if (
          Math.abs(target.x - layer.x) > SETTLED ||
          Math.abs(target.y - layer.y) > SETTLED
        ) {
          moving = true
        }

        // Rounded to whole pixels: sub-pixel transforms on a large blurred
        // texture make the compositor resample it every frame for a
        // difference nobody can see.
        if (layer.el) {
          layer.el.style.transform = `translate3d(${Math.round(layer.x)}px, ${Math.round(
            layer.y,
          )}px, 0)`
        }
      }

      if (moving) {
        frame = requestAnimationFrame(step)
      } else {
        running = false
        frame = 0
      }
    }

    function wake() {
      if (!running && document.visibilityState === 'visible') {
        frame = requestAnimationFrame(step)
      }
    }

    function onMove(e: PointerEvent) {
      target.x = e.clientX
      target.y = e.clientY

      // Faded in on the first real movement rather than on mount, so the light
      // does not sit in the middle of the screen waiting for a cursor that may
      // never arrive (a visitor who scrolled in with the keyboard).
      if (!seen) {
        seen = true
        root!.dataset.seen = 'true'
      }

      // The ring swells over anything clickable. `closest` on the event target
      // is cheap — no hit-testing, no layout read.
      const el = e.target as Element | null
      const hot = el?.closest?.('a, button, [role="button"], summary, label, input, select')
      root!.dataset.hot = hot ? 'true' : 'false'

      wake()
    }

    function onLeave() {
      root!.dataset.seen = 'false'
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') wake()
      else if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
        running = false
      }
    }

    // Passive: this never calls preventDefault, and saying so lets the browser
    // dispatch it without waiting to find out.
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div ref={rootRef} className="pa" aria-hidden="true" data-active="false">
      {/* Painted back to front. Each pool is an ELLIPSE on a slowly rotating
          wrapper — a perfect circle following the mouse looks like a torch,
          and the rotation is what keeps the edge from ever settling into a
          recognisable shape. */}
      <div className="pa__layer pa__far">
        <span className="pa__blob pa__blob--far" />
      </div>
      <div className="pa__layer pa__mid">
        <span className="pa__blob pa__blob--mid" />
      </div>
      <div className="pa__layer pa__core">
        <span className="pa__blob pa__blob--core" />
      </div>

      {/* The cursor ring. Deliberately NOT a replacement cursor — the native
          one stays visible, because hiding it costs real usability over text
          fields and links for the sake of a flourish. This is a halo around
          it. */}
      <div className="pa__layer pa__ring">
        <span className="pa__ring-mark" />
      </div>
    </div>
  )
}
