/**
 * Live atmospheric backdrop — golden smoke waves + floating dust motes.
 *
 * Deliberately a *server* component: it renders once, ships zero JavaScript,
 * and every pixel of motion is handled by the compositor via CSS keyframes.
 * A canvas or requestAnimationFrame loop would burn main-thread time on every
 * frame of a page whose real job is scrolling a product grid.
 *
 * The motes need per-particle variation (position, size, drift, speed) or the
 * field reads as a grid. Math.random() cannot supply it: the server and the
 * client would each roll different numbers and React would throw a hydration
 * mismatch. So the values come from a seeded PRNG evaluated at module scope —
 * same seed, same sequence, both sides, every time.
 */

/** mulberry32 — small, fast, and identical across environments. */
function makeRng(seed: number) {
  return function next() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Mote = {
  left: number
  size: number
  sway: number
  duration: number
  delay: number
  opacity: number
}

function buildMotes(count: number): Mote[] {
  const rand = makeRng(0x7c3a91)
  const motes: Mote[] = []
  for (let i = 0; i < count; i += 1) {
    motes.push({
      // Spread across the full width, nudged by the index so a run of unlucky
      // rolls cannot leave a visibly empty column.
      left: (i / count) * 100 + rand() * (100 / count),
      size: 1.5 + rand() * 3.5,
      // Horizontal drift, signed — motes wander both ways, like real dust.
      sway: (rand() - 0.5) * 140,
      // Wide spread of durations is what stops the field from pulsing in
      // unison, which is the tell that gives away a CSS particle system.
      duration: 26 + rand() * 34,
      // Negative delays start each mote mid-flight, so the field is already
      // populated on first paint instead of rising from the bottom edge.
      delay: -rand() * 60,
      opacity: 0.25 + rand() * 0.55,
    })
  }
  return motes
}

const MOTES = buildMotes(28)

export function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden="true">
      {/* Three slow gradient bodies at different sizes, speeds and directions.
          Overlapping them in `screen` blend is what produces the shifting,
          non-repeating shapes — no single layer ever reads as a moving blob. */}
      <div className="ambient__wave ambient__wave--a" />
      <div className="ambient__wave ambient__wave--b" />
      <div className="ambient__wave ambient__wave--c" />

      {/* A wide, very slow sheen that crosses the viewport — the "breath". */}
      <div className="ambient__sheen" />

      <div className="ambient__dust">
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="ambient__mote"
            style={
              {
                '--x': `${m.left}%`,
                '--s': `${m.size}px`,
                '--sway': `${m.sway}px`,
                '--d': `${m.duration}s`,
                '--delay': `${m.delay}s`,
                '--o': m.opacity,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Vignette last, so the corners settle back into charcoal and the motes
          fade out at the edges instead of clipping against them. */}
      <div className="ambient__vignette" />
    </div>
  )
}
