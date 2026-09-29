'use client'

import { useEffect, useRef } from 'react'

/**
 * Ribbon glow — slow bands of light drifting behind the hero, like light
 * passing across silk.
 *
 * Tuned for the light theme: the ribbons are champagne and soft gold at very
 * low opacity with pearl-white highlights along one edge, and a single faint
 * rose-gold band for warmth. No saturated colour, no neon — on the ivory
 * ground they read as a sheen, not as graphics.
 *
 * COST. A 2D canvas, drawn at a fraction of the hero's size (RENDER_SCALE)
 * and stretched by CSS — the upscale is what makes the edges soft, so no blur
 * filter runs per frame. ~30 fps is plenty for motion this slow. The loop
 * stops when the hero is scrolled out of view or the tab is hidden, and
 * everything is torn down on unmount.
 *
 * MOTION. One full drift takes about a minute. The pointer bends the ribbons
 * a little toward it, eased so it glides rather than tracks. Under
 * prefers-reduced-motion (or the site's own "reduce animations" switch) a
 * single still frame is drawn and nothing moves.
 *
 * The canvas is decoration only: aria-hidden, pointer-events none, below the
 * hero's content — it can never take a click, a tap or a scroll.
 */

type Ribbon = {
  /** Vertical centre, as a fraction of the height. */
  y: number
  /** Thickness at its widest, as a fraction of the height. */
  width: number
  /** Wave amplitude, fraction of the height. */
  amp: number
  /** Spatial frequency (waves across the width). */
  freq: number
  /** Drift speed, radians per second. */
  speed: number
  phase: number
  /** rgb of the body. */
  color: [number, number, number]
  /** Peak opacity of the body. */
  alpha: number
}

const RIBBONS: Ribbon[] = [
  // Champagne — the main sweep.
  { y: 0.36, width: 0.2, amp: 0.1, freq: 1.1, speed: 0.1, phase: 0, color: [214, 186, 120], alpha: 0.22 },
  // Soft gold, lower and slower.
  { y: 0.62, width: 0.16, amp: 0.08, freq: 0.8, speed: -0.07, phase: 1.9, color: [197, 160, 89], alpha: 0.16 },
  // Rose-gold, faint — warmth, not colour.
  { y: 0.5, width: 0.24, amp: 0.12, freq: 0.6, speed: 0.05, phase: 3.4, color: [222, 176, 150], alpha: 0.1 },
  // A thin pale-gold thread near the top.
  { y: 0.2, width: 0.08, amp: 0.06, freq: 1.4, speed: -0.09, phase: 4.6, color: [226, 200, 140], alpha: 0.16 },
  // A thin one low down.
  { y: 0.8, width: 0.09, amp: 0.05, freq: 1.2, speed: 0.08, phase: 2.7, color: [205, 172, 110], alpha: 0.13 },
]

/** Canvas pixels per CSS pixel. Low on purpose: the stretch is the blur. */
const RENDER_SCALE = 0.35
const FRAME_MS = 1000 / 30
const SEGMENTS = 48

export function HeroRibbons() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const still =
      document.documentElement.dataset.motion === 'reduce' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // Phones get the three main ribbons: less to draw, and a narrow screen
    // has no room for five.
    const ribbons = window.matchMedia?.('(max-width: 640px)').matches ? RIBBONS.slice(0, 3) : RIBBONS

    let w = 0
    let h = 0
    let frame = 0
    let last = 0
    let running = false
    let visible = true
    const start = performance.now()
    // Pointer, in 0–1 of the hero; `eased` glides toward `target`.
    const target = { x: 0.5, y: 0.5 }
    const eased = { x: 0.5, y: 0.5 }

    function resize() {
      const rect = canvas!.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width * RENDER_SCALE))
      h = Math.max(1, Math.round(rect.height * RENDER_SCALE))
      canvas!.width = w
      canvas!.height = h
    }

    function draw(time: number) {
      const t = (time - start) / 1000
      eased.x += (target.x - eased.x) * 0.03
      eased.y += (target.y - eased.y) * 0.03
      ctx!.clearRect(0, 0, w, h)

      for (const r of ribbons) {
        const top: [number, number][] = []
        const bottom: [number, number][] = []
        for (let i = 0; i <= SEGMENTS; i++) {
          const u = i / SEGMENTS
          const x = u * w
          // Two waves at different rates: the ribbon twists, not just bobs.
          const wave =
            Math.sin(u * Math.PI * 2 * r.freq + t * r.speed + r.phase) * r.amp +
            Math.sin(u * Math.PI * 2 * r.freq * 0.47 - t * r.speed * 0.6 + r.phase * 1.7) * r.amp * 0.5
          // The pointer draws the ribbon gently toward it, strongest nearby.
          const pull = (eased.y - r.y) * 0.18 * Math.exp(-Math.pow((u - eased.x) * 2.2, 2))
          const cy = (r.y + wave + pull) * h
          // Thickness breathes along the length — where silk folds, it narrows.
          const thick = r.width * h * (0.35 + 0.65 * Math.abs(Math.sin(u * Math.PI * r.freq + t * r.speed * 0.8 + r.phase)))
          top.push([x, cy - thick / 2])
          bottom.push([x, cy + thick / 2])
        }

        // Body: fades in and out along the length, strongest mid-screen.
        const [cr, cg, cb] = r.color
        const along = ctx!.createLinearGradient(0, 0, w, 0)
        along.addColorStop(0, `rgba(${cr},${cg},${cb},0)`)
        along.addColorStop(0.3, `rgba(${cr},${cg},${cb},${r.alpha})`)
        along.addColorStop(0.7, `rgba(${cr},${cg},${cb},${r.alpha})`)
        along.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        ctx!.beginPath()
        ctx!.moveTo(top[0][0], top[0][1])
        for (const [x, y] of top) ctx!.lineTo(x, y)
        for (let i = bottom.length - 1; i >= 0; i--) ctx!.lineTo(bottom[i][0], bottom[i][1])
        ctx!.closePath()
        ctx!.fillStyle = along
        ctx!.fill()

        // Highlight: a pearl-white line riding the upper edge — the
        // reflection that makes a band read as a material.
        const sheen = ctx!.createLinearGradient(0, 0, w, 0)
        sheen.addColorStop(0, 'rgba(255,255,255,0)')
        sheen.addColorStop(0.5, `rgba(255,255,255,${Math.min(0.55, r.alpha * 3)})`)
        sheen.addColorStop(1, 'rgba(255,255,255,0)')
        ctx!.beginPath()
        ctx!.moveTo(top[0][0], top[0][1] + 1)
        for (const [x, y] of top) ctx!.lineTo(x, y + 1)
        ctx!.strokeStyle = sheen
        ctx!.lineWidth = Math.max(1, h * 0.012)
        ctx!.stroke()
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
    const onPointer = (e: PointerEvent) => {
      const rect = canvas!.getBoundingClientRect()
      target.x = (e.clientX - rect.left) / rect.width
      target.y = (e.clientY - rect.top) / rect.height
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
    if (!still) window.addEventListener('pointermove', onPointer, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    play()

    return () => {
      pause()
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="hero__ribbons" />
}
