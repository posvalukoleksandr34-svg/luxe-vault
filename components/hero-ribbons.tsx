'use client'

import { useEffect, useRef } from 'react'

/**
 * Ribbon glow — broad bands of champagne silk turning slowly behind the hero.
 *
 * Each ribbon is modelled as a strip of fabric: an axis that waves (the waves
 * travel along it, like cloth in a slow draught) and a width that TWISTS along
 * its length. The twist is what makes it read as silk rather than as a
 * gradient: where the strip turns edge-on it pinches to a line, where it faces
 * the light it opens into a full sheet, and a satin highlight slides across it
 * as it turns. The light comes from above and in front, so the fabric is
 * bronze where it turns away, champagne where it faces you, and pearl where
 * it catches — and a soft gold glow spills from every edge.
 *
 * PALETTE. Deep bronze → gold → champagne → ivory, nothing cool and nothing
 * saturated. On the ivory ground the ribbons read by VALUE — bronze edges
 * against pearl highlights — which is what keeps them clearly visible without
 * turning them into colour.
 *
 * COST. A 2D canvas at half the hero's size, stretched by CSS (a little of the
 * softness is that stretch). Per ribbon and frame: one filled shape with a
 * glow, one clip and a handful of strokes — a few dozen draw calls in all.
 * 24 fps — film rate — is plenty for motion this slow. The loop stops when the hero is
 * scrolled out of view or the tab is hidden, and everything is torn down on
 * unmount.
 *
 * MOTION. A full cycle takes about a minute. The pointer — or a finger on a
 * phone — draws the ribbons nearest to it gently toward it, eased so they
 * glide rather than track, and lets them go a few seconds after it stops.
 * Under prefers-reduced-motion (or the site's own "reduce animations" switch)
 * a single still frame is drawn and nothing moves.
 *
 * The canvas is decoration only: aria-hidden, pointer-events none, below the
 * hero's content — it can never take a click, a tap or a scroll.
 */

type Ribbon = {
  /** Ends of the ribbon's axis, as fractions of the hero. Past the edges on
   *  purpose: a ribbon that starts on screen looks cut. */
  from: [number, number]
  to: [number, number]
  /** Full width of the fabric, as a fraction of the hero's size. */
  width: number
  /** How far the axis waves, as a fraction of the hero's size. */
  amp: number
  /** Waves along the length. */
  waves: number
  /** How fast the waves travel, radians per second. */
  speed: number
  /** Half-turns of twist along the length. */
  twist: number
  /** How fast the twist rolls along, radians per second. */
  roll: number
  phase: number
  /** Shifts the shading: below 0 a deeper, bronze ribbon; above, paler. */
  tone: number
  /** Opacity of the fabric. */
  alpha: number
}

/** Back to front. */
const RIBBONS: Ribbon[] = [
  // Bronze-gold, broad and far back: the depth behind the others.
  { from: [-0.2, 0.86], to: [1.2, 0.16], width: 0.4, amp: 0.07, waves: 1.1, speed: 0.11, twist: 1.3, roll: 0.07, phase: 0.6, tone: -0.12, alpha: 0.5 },
  // The main champagne sheet, sweeping down across the frame.
  { from: [-0.2, 0.18], to: [1.2, 0.78], width: 0.44, amp: 0.09, waves: 0.9, speed: -0.09, twist: 1.1, roll: -0.06, phase: 2.1, tone: 0.06, alpha: 0.86 },
  // Gold, narrower, crossing low.
  { from: [-0.2, 0.64], to: [1.2, 1.0], width: 0.26, amp: 0.06, waves: 1.4, speed: 0.13, twist: 1.6, roll: 0.09, phase: 4.2, tone: -0.06, alpha: 0.8 },
  // A pale ivory ribbon high up, catching the light.
  { from: [-0.2, 0.06], to: [1.2, 0.36], width: 0.2, amp: 0.05, waves: 1.2, speed: -0.12, twist: 1.4, roll: 0.08, phase: 5.3, tone: 0.18, alpha: 0.84 },
]

/** Shading ramp, dark to light: deep bronze, bronze, gold, champagne, ivory. */
const RAMP: [number, [number, number, number]][] = [
  [0, [134, 98, 50]],
  [0.3, [166, 126, 66]],
  [0.55, [204, 167, 96]],
  [0.8, [233, 213, 166]],
  [1, [251, 243, 224]],
]

/** Canvas pixels per CSS pixel. */
const RENDER_SCALE = 0.5
const FRAME_MS = 1000 / 24
/** Samples along each ribbon, and gradient stops along it. */
const SAMPLES = 64
const STOPS = 16
/** The light, as a tilt of the fabric's surface: above and in front. */
const LIGHT = 0.55
/** Where the satin highlight sits — halfway between the light and the eye. */
const SPECULAR = LIGHT / 2
/** How much the fabric bulges across its width (radians of tilt, edge to centre). */
const BULGE = 0.9
/** Glow around each ribbon, CSS px. */
const GLOW = 34

function ramp(b: number): [number, number, number] {
  const v = Math.min(1, Math.max(0, b))
  for (let i = 1; i < RAMP.length; i++) {
    const [p1, c1] = RAMP[i]
    if (v <= p1) {
      const [p0, c0] = RAMP[i - 1]
      const k = (v - p0) / (p1 - p0)
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number]
    }
  }
  return RAMP[RAMP.length - 1][1]
}

/** Brightness of fabric whose surface is tilted by `tilt` toward the light. */
function lit(tilt: number, tone: number): number {
  return 0.18 + 0.82 * Math.max(0, Math.cos(tilt - LIGHT)) + tone
}

export function HeroRibbons() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const still =
      document.documentElement.dataset.motion === 'reduce' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    let w = 0
    let h = 0
    let frame = 0
    let last = 0
    let running = false
    let visible = true
    const start = performance.now()
    // Pointer, in 0–1 of the hero. `eased` glides toward it; `eased.pull`
    // rises while the pointer moves and fades a few seconds after it stops.
    const pointer = { x: 0.5, y: 0.5 }
    const eased = { x: 0.5, y: 0.5, pull: 0 }
    let lastMove = -Infinity

    function resize() {
      const rect = canvas!.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width * RENDER_SCALE))
      h = Math.max(1, Math.round(rect.height * RENDER_SCALE))
      canvas!.width = w
      canvas!.height = h
    }

    function draw(time: number) {
      const t = (time - start) / 1000
      eased.x += (pointer.x - eased.x) * 0.04
      eased.y += (pointer.y - eased.y) * 0.04
      eased.pull += ((time - lastMove < 3000 ? 1 : 0) - eased.pull) * 0.025

      ctx!.clearRect(0, 0, w, h)
      ctx!.lineJoin = 'round'
      ctx!.lineCap = 'round'
      // The hero's size: one number for widths and waves, so a ribbon is as
      // bold on a phone held upright as on a wide screen — capped by the
      // height, or on a wide screen the ribbons would fill the frame.
      const size = Math.min(Math.sqrt(w * h), h * 1.1)

      for (const r of RIBBONS) {
        const ax = r.from[0] * w
        const ay = r.from[1] * h
        const len = Math.hypot(r.to[0] * w - ax, r.to[1] * h - ay)
        // Along the axis, and across it (pointing down the screen).
        const dx = (r.to[0] * w - ax) / len
        const dy = (r.to[1] * h - ay) / len
        const nx = -dy
        const ny = dx
        const half = (r.width * size) / 2
        // The pointer in this ribbon's frame: how far along, how far across.
        const px = eased.x * w - ax
        const py = eased.y * h - ay
        const pAlong = (px * dx + py * dy) / len
        const pAcross = px * nx + py * ny

        const top: number[] = []
        const bottom: number[] = []
        const shine: number[] = []
        for (let i = 0; i <= SAMPLES; i++) {
          const u = i / SAMPLES
          // Two travelling waves at different rates: the ribbon undulates
          // rather than bobbing.
          let across =
            (Math.sin(u * Math.PI * 2 * r.waves - t * r.speed + r.phase) +
              0.45 * Math.sin(u * Math.PI * 2 * r.waves * 0.53 + t * r.speed * 0.7 + r.phase * 1.9)) *
            r.amp *
            size
          // The pointer draws the nearest stretch toward it — strongest right
          // under it, nothing for a ribbon far away.
          const gap = pAcross - across
          across +=
            gap *
            0.4 *
            eased.pull *
            Math.exp(-Math.pow(((u - pAlong) * len) / (0.35 * size), 2)) *
            Math.exp(-Math.pow(gap / (0.55 * size), 2))
          const cx = ax + dx * u * len + nx * across
          const cy = ay + dy * u * len + ny * across
          // The twist: the visible width is the fabric's width × cos(turn).
          const turn = u * Math.PI * r.twist + t * r.roll + r.phase * 0.7
          const hw = half * Math.abs(Math.cos(turn))
          top.push(cx - nx * hw, cy - ny * hw)
          bottom.push(cx + nx * hw, cy + ny * hw)
          // The satin highlight: across the bulge, the line where the surface
          // faces halfway between light and eye. Clamped to the fabric; where
          // it would fall off an edge, its gradient below makes it invisible.
          const facing = Math.atan(Math.tan(turn))
          const at = Math.max(-1, Math.min(1, (facing - SPECULAR) / BULGE))
          shine.push(cx + nx * hw * at, cy + ny * hw * at)
        }

        // Shading along the length, from the twist at each stop.
        const body = ctx!.createLinearGradient(ax, ay, ax + dx * len, ay + dy * len)
        const rimTop = ctx!.createLinearGradient(ax, ay, ax + dx * len, ay + dy * len)
        const rimBottom = ctx!.createLinearGradient(ax, ay, ax + dx * len, ay + dy * len)
        const gloss = ctx!.createLinearGradient(ax, ay, ax + dx * len, ay + dy * len)
        for (let j = 0; j < STOPS; j++) {
          const u = j / (STOPS - 1)
          const turn = u * Math.PI * r.twist + t * r.roll + r.phase * 0.7
          const facing = Math.atan(Math.tan(turn))
          const [br, bg, bb] = ramp(lit(facing, r.tone))
          body.addColorStop(u, `rgb(${br},${bg},${bb})`)
          // Upper edge tilts up into the light; lower edge away from it.
          const up = Math.min(1, lit(facing + BULGE * 0.85, r.tone))
          const down = Math.max(0, 1 - lit(facing - BULGE * 0.85, r.tone))
          rimTop.addColorStop(u, `rgba(255,250,236,${(0.25 + 0.55 * up).toFixed(3)})`)
          rimBottom.addColorStop(u, `rgba(110,76,34,${(0.12 + 0.5 * down).toFixed(3)})`)
          const off = Math.abs((facing - SPECULAR) / BULGE)
          const spec = Math.max(0, Math.min(1, (1 - off) / 0.4)) * Math.pow(Math.abs(Math.cos(turn)), 0.5)
          gloss.addColorStop(u, `rgba(255,252,242,${spec.toFixed(3)})`)
        }

        const shape = new Path2D()
        shape.moveTo(top[0], top[1])
        for (let i = 2; i < top.length; i += 2) shape.lineTo(top[i], top[i + 1])
        for (let i = bottom.length - 2; i >= 0; i -= 2) shape.lineTo(bottom[i], bottom[i + 1])
        shape.closePath()

        // The fabric, with its glow spilling out around it.
        ctx!.save()
        ctx!.globalAlpha = r.alpha
        ctx!.shadowColor = 'rgba(206,160,72,0.55)'
        ctx!.shadowBlur = GLOW * RENDER_SCALE
        ctx!.fillStyle = body
        ctx!.fill(shape)
        ctx!.restore()

        // Light and shade inside it: clipped, so nothing spills past an edge.
        ctx!.save()
        ctx!.clip(shape)
        ctx!.globalAlpha = r.alpha
        const line = (points: number[], width: number, style: CanvasGradient) => {
          ctx!.beginPath()
          ctx!.moveTo(points[0], points[1])
          for (let i = 2; i < points.length; i += 2) ctx!.lineTo(points[i], points[i + 1])
          ctx!.lineWidth = width
          ctx!.strokeStyle = style
          ctx!.stroke()
        }
        // Shade along the lower edge — the fold turning away. Only its
        // inner half shows, so it reads as volume, not an outline.
        line(bottom, half * 0.9, rimBottom)
        // Light along the upper edge: a fine bright line.
        line(top, 3 * RENDER_SCALE, rimTop)
        // The satin highlight: a broad soft sheen with a brighter core.
        ctx!.globalAlpha = r.alpha * 0.45
        line(shine, half * 0.55, gloss)
        ctx!.globalAlpha = r.alpha * 0.9
        line(shine, half * 0.12, gloss)
        ctx!.restore()
      }
    }

    function loop(time: number) {
      frame = requestAnimationFrame(loop)
      if (time - last < FRAME_MS) return
      last = time
      draw(time)
    }

    function play() {
      if (running || still || !visible || document.hidden) return
      running = true
      frame = requestAnimationFrame(loop)
    }

    function pause() {
      running = false
      cancelAnimationFrame(frame)
    }

    resize()
    draw(performance.now())

    const onResize = () => {
      resize()
      draw(performance.now())
    }
    const aim = (clientX: number, clientY: number) => {
      const rect = canvas!.getBoundingClientRect()
      pointer.x = (clientX - rect.left) / rect.width
      pointer.y = (clientY - rect.top) / rect.height
      lastMove = performance.now()
    }
    const onPointer = (e: PointerEvent) => aim(e.clientX, e.clientY)
    // A finger that starts a scroll stops sending pointer events; touch
    // events keep coming, so the ribbons follow a swipe too.
    const onTouch = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) aim(touch.clientX, touch.clientY)
    }
    const onVisibility = () => (document.hidden ? pause() : play())

    // Only while the hero is on screen.
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) play()
      else pause()
    })
    observer.observe(canvas)

    window.addEventListener('resize', onResize, { passive: true })
    if (!still) {
      window.addEventListener('pointermove', onPointer, { passive: true })
      window.addEventListener('touchstart', onTouch, { passive: true })
      window.addEventListener('touchmove', onTouch, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    play()

    return () => {
      pause()
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('touchstart', onTouch)
      window.removeEventListener('touchmove', onTouch)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="hero__ribbons" />
}
