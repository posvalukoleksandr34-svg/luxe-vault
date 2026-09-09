/**
 * Generates the LUXE VAULT cursor assets.
 *
 *   node scripts/build-cursors.mjs
 *
 * Writes public/cursors/{arrow,pointer}.png and an @2x of each.
 *
 * WHY PNG AND NOT SVG. `cursor: url(x.svg)` is silently ignored by Safari —
 * the visitor simply gets the system arrow, which is the one failure mode
 * nobody would notice in review and everybody would notice on a Mac. PNG is
 * the only raster format every engine accepts for a cursor.
 *
 * WHY GENERATED AND NOT DRAWN BY HAND. The shapes are signed distance fields,
 * so the fill, the outline and the antialiasing all fall out of one number per
 * pixel: `d` is the distance to the shape's edge, negative inside. That gives
 * a genuinely crisp 2x asset from the same source as the 1x, and it means the
 * proportions can be tuned by editing a number rather than by redrawing.
 *
 * WHY THERE IS A DARK OUTLINE. A gold cursor on a gold-lit page is invisible
 * over a pale product photograph — and this is a shop, so it will spend most
 * of its life over photographs. Every shape carries a near-black stroke and a
 * soft drop shadow beneath it, which is the same reason the system arrow is
 * white with a black keyline.
 */

import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const OUT = 'public/cursors'

/* -------------------------------------------------------------- geometry -- */

/** Signed distance to a polygon. Negative inside. (Inigo Quilez's method.) */
function sdPolygon(v, px, py) {
  const n = v.length
  let d = (px - v[0][0]) ** 2 + (py - v[0][1]) ** 2
  let s = 1
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const ex = v[j][0] - v[i][0]
    const ey = v[j][1] - v[i][1]
    const wx = px - v[i][0]
    const wy = py - v[i][1]
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
    const bx = wx - ex * t
    const by = wy - ey * t
    d = Math.min(d, bx * bx + by * by)
    const c1 = py >= v[i][1]
    const c2 = py < v[j][1]
    const c3 = ex * wy > ey * wx
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s
  }
  return s * Math.sqrt(d)
}

/** Signed distance to a capsule — a segment with a radius. Fingers. */
function sdCapsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - bax * h, pay - bay * h) - r
}

/** Signed distance to a rounded box. The palm. */
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r
  const qy = Math.abs(py - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** Smooth union — melts fingers into the palm instead of leaving a seam. */
function smin(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k))
  return b * (1 - h) + a * h - k * h * (1 - h)
}

/* ---------------------------------------------------------------- shapes -- */

/**
 * The classic arrow, in design units with its tip at the origin.
 *
 * Deliberately the familiar silhouette rather than an invented one: a cursor
 * is the one piece of a page nobody should have to interpret. Only its
 * FINISH is ours.
 */
const ARROW = [
  [0, 0],
  [0, 16.4],
  [4.05, 12.6],
  [6.5, 18.1],
  [9.05, 17.0],
  [6.75, 11.6],
  [11.9, 11.25],
]

function arrowField(x, y) {
  return sdPolygon(ARROW, x, y)
}

/**
 * A pointing hand.
 *
 * TUNED FOR 32 PIXELS, which is the constraint that decides everything here.
 * The first version used realistic proportions and a soft `smin`, and at 32px
 * the keyline swallowed the gaps between the fingers — it rendered as a
 * mitten. So: fewer design units across, a tighter join constant so the
 * notches between fingers survive, and a thinner keyline (see the spec table).
 */
function handField(x, y) {
  // 0.72 rather than ~1.2: a smooth blend of this radius is wider than the
  // gap it sits in, so at this size a soft union closes the notches entirely.
  const k = 0.72
  let d = sdCapsule(x, y, 5.6, 2.2, 5.6, 10.2, 1.7) // index, extended
  d = smin(d, sdCapsule(x, y, 9.3, 7.6, 9.3, 11.0, 1.62), k) // middle
  d = smin(d, sdCapsule(x, y, 12.5, 8.4, 12.5, 11.4, 1.6), k) // ring
  d = smin(d, sdCapsule(x, y, 15.4, 9.6, 15.4, 12.0, 1.5), k) // little
  d = smin(d, sdRoundBox(x, y, 10.6, 14.6, 5.6, 4.1, 2.2), k) // palm
  d = smin(d, sdCapsule(x, y, 5.2, 13.2, 3.9, 16.1, 1.7), k) // thumb
  return d
}

/* ------------------------------------------------------------- rendering -- */

const GOLD_TOP = [246, 219, 140]
const GOLD_MID = [212, 175, 55]
const GOLD_BOT = [154, 112, 30]
const INK = [10, 9, 8]

function goldAt(t) {
  // Two-stop ramp with the highlight in the upper third, which is where a
  // light source above the page would actually catch a metal edge.
  const u = Math.min(1, Math.max(0, t))
  const [a, b, m] = u < 0.42 ? [GOLD_TOP, GOLD_MID, u / 0.42] : [GOLD_MID, GOLD_BOT, (u - 0.42) / 0.58]
  return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m]
}

/** Linear ramp from 1 at `inner` to 0 at `outer`, used for every soft edge. */
function ramp(d, inner, outer) {
  if (d <= inner) return 1
  if (d >= outer) return 0
  return (outer - d) / (outer - inner)
}

/**
 * Rasterises one field into a PNG.
 *
 * `scale` maps design units to pixels, `ox`/`oy` place the shape. The 2x asset
 * is the same call with both doubled — nothing is resampled, so the retina
 * version is genuinely sharper rather than a blown-up copy.
 */
function render(field, { size, scale, ox, oy, stroke, designHeight }) {
  const png = new PNG({ width: size, height: size })

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      // Sample at the pixel centre, in design units.
      const x = (px + 0.5 - ox) / scale
      const y = (py + 0.5 - oy) / scale
      const d = field(x, y) * scale // distance in PIXELS, so edges are uniform

      const half = stroke / 2

      // Shadow first: offset down-right, wide and soft. This is what keeps the
      // cursor legible over a pale photograph.
      const sd = field((px + 0.5 - ox - 0.9) / scale, (py + 0.5 - oy - 1.1) / scale) * scale
      const shadow = ramp(sd, -half, half + 2.2) * 0.5

      const inside = ramp(d, -half - 0.5, -half + 0.5)
      const outline = ramp(Math.abs(d) - half, -0.5, 0.5)

      const [gr, gg, gb] = goldAt(y / designHeight)

      // Composite: shadow, then gold, then the keyline over both.
      let r = INK[0]
      let g = INK[1]
      let b = INK[2]
      let a = shadow

      // gold over shadow
      const na1 = inside + a * (1 - inside)
      if (na1 > 0) {
        r = (gr * inside + r * a * (1 - inside)) / na1
        g = (gg * inside + g * a * (1 - inside)) / na1
        b = (gb * inside + b * a * (1 - inside)) / na1
      }
      a = na1

      // keyline over that
      const na2 = outline + a * (1 - outline)
      if (na2 > 0) {
        r = (INK[0] * outline + r * a * (1 - outline)) / na2
        g = (INK[1] * outline + g * a * (1 - outline)) / na2
        b = (INK[2] * outline + b * a * (1 - outline)) / na2
      }
      a = na2

      const i = (py * size + px) << 2
      png.data[i] = Math.round(Math.min(255, Math.max(0, r)))
      png.data[i + 1] = Math.round(Math.min(255, Math.max(0, g)))
      png.data[i + 2] = Math.round(Math.min(255, Math.max(0, b)))
      png.data[i + 3] = Math.round(Math.min(255, Math.max(0, a * 255)))
    }
  }
  return png
}

function write(name, png) {
  const file = path.join(OUT, name)
  fs.writeFileSync(file, PNG.sync.write(png))
  return `${file} (${png.width}x${png.height}, ${fs.statSync(file).size} B)`
}

/* ----------------------------------------------------------------- build -- */

fs.mkdirSync(OUT, { recursive: true })

/**
 * 32x32 at 1x. Not larger: Windows silently refuses cursor images above
 * 32x32 in several configurations, and a cursor that vanishes on one platform
 * is worse than a smaller one everywhere. Retina is served by the @2x through
 * image-set(), which is resolution selection rather than a bigger cursor.
 */
const SIZE = 32

const specs = [
  {
    name: 'arrow',
    field: arrowField,
    designHeight: 18.1,
    // The tip sits half a pixel inside the canvas so its keyline is not
    // clipped, while the declared hotspot stays 0 0 — half a pixel is far
    // below anything a hand can aim.
    fit: (s) => ({ scale: (s * 0.92) / 18.1, ox: 0.5, oy: 0.5 }),
    hotspot: '0 0',
  },
  {
    name: 'pointer',
    field: handField,
    designHeight: 18.4,
    // Thinner keyline than the arrow: the hand has interior gaps to protect,
    // the arrow has none.
    stroke: 1.15,
    fit: (s) => ({ scale: (s * 0.85) / 18.6, ox: s * 0.055, oy: s * 0.02 }),
    // The index fingertip, not the corner: a hand cursor whose hot pixel is
    // its top-left corner clicks a centimetre above whatever it is over.
    hotspot: '8 2',
  },
]

/*
 * NO CUSTOM I-BEAM.
 *
 * A text cursor was drawn and then dropped. At 32px its stem came out one
 * pixel of gold inside a two-pixel keyline — it read as a hollow box, not as
 * an I-beam. More to the point, the caret is the one cursor people use to aim
 * BETWEEN characters, and the native one is tuned per platform for exactly
 * that. Inputs keep `cursor: text`, and the site loses nothing.
 */

console.log('')
for (const spec of specs) {
  for (const [suffix, mult] of [['', 1], ['@2x', 2]]) {
    const size = SIZE * mult
    const { scale, ox, oy } = spec.fit(size)
    const png = render(spec.field, {
      size,
      scale,
      ox,
      oy,
      // The keyline grows with the asset so it reads identically at both
      // densities rather than getting hairline-thin on retina.
      stroke: (spec.stroke ?? 1.5) * mult,
      designHeight: spec.designHeight,
    })
    console.log('  ' + write(`${spec.name}${suffix}.png`, png))
  }
}

console.log('\n  hotspots: ' + specs.map((s) => `${s.name} → ${s.hotspot}`).join(', ') + '\n')
