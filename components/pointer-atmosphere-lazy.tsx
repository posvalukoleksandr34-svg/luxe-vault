'use client'

import dynamic from 'next/dynamic'

/**
 * Loads the cursor-following gold light off the critical path.
 *
 * A CLIENT wrapper, because the root layout is a Server Component and
 * `dynamic(..., { ssr: false })` cannot be used from one — nor can a server
 * component dot into a client module's exports. The wrapper is the smallest
 * thing that can hold the dynamic() call, and it costs one tiny module in the
 * shared bundle instead of the whole effect.
 *
 * The effect is decoration and renders NOTHING on a touch device or under
 * prefers-reduced-motion, so a static import spent first-load bytes on every
 * page for a large share of visitors who would never see a single pixel of
 * it. `ssr: false` is free here: the layer is transparent until the first
 * pointer movement, so there is no server markup worth having.
 */
const PointerAtmosphere = dynamic(
  () => import('@/components/pointer-atmosphere').then((m) => m.PointerAtmosphere),
  { ssr: false },
)

export function PointerAtmosphereLazy() {
  return <PointerAtmosphere />
}
