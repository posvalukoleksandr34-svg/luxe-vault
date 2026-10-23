import 'server-only'

import { createHash, createHmac } from 'node:crypto'

/**
 * The review link's token.
 *
 * DERIVED, not stored: HMAC-SHA256 of a server secret over the request's id
 * and its random token_nonce, base64url (43 characters, 256 bits). The
 * database keeps only SHA-256(token), so a leaked row is not a working link,
 * and a retry after a crashed send rebuilds the SAME token — the email the
 * provider may already have delivered (it deduplicates on the idempotency
 * key) keeps a working link. A manual retry draws a new nonce, so a link from
 * an earlier attempt stops working.
 *
 * Key: REVIEW_LINK_SECRET, else the service-role key (always present on the
 * server), labelled so it cannot collide with any other HMAC of that key.
 * Rotating the key invalidates outstanding links, nothing else.
 */
function key(): string | null {
  return process.env.REVIEW_LINK_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null
}

export function linkToken(requestId: string, nonce: string): string | null {
  const k = key()
  if (!k) return null
  return createHmac('sha256', k).update(`lv-review-link:${requestId}:${nonce}`).digest('base64url')
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Exactly what linkToken produces; anything else is not looked up at all. */
export function isTokenShape(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}
