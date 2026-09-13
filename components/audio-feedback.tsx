'use client'

import { useEffect } from 'react'
import { startGlobalFeedback } from '@/lib/audio/global-feedback'

/**
 * Mounts the site-wide UI sound layer. Renders nothing.
 *
 * In the root layout, so every route has it — including the ones that render
 * neither Header nor Footer (checkout, the legal pages, a shared capsule).
 * Everything it does lives in an effect, so it costs the server render
 * nothing and the first paint nothing.
 */
export function AudioFeedback() {
  useEffect(() => startGlobalFeedback(), [])
  return null
}
