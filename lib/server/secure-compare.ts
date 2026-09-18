import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison for secrets: order lookup tokens, the cron
 * bearer secret, anything a caller could otherwise guess one character at a
 * time by timing `!==`.
 *
 * Both sides are hashed first so the buffers are always the same length —
 * timingSafeEqual throws on unequal lengths, and returning early on a length
 * mismatch would leak the secret's length. Non-strings and empty strings never
 * match, so a missing token cannot equal a missing secret.
 */
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * The shared-secret check every cron route uses: `Authorization: Bearer <secret>`.
 * False when the secret is unset, so a missing variable fails closed.
 */
export function hasBearerSecret(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization?.startsWith('Bearer ')) return false
  return safeEqual(authorization.slice('Bearer '.length), secret)
}
