// Server-only helpers for the private admin console. Never import this file
// from a 'use client' component — the password/secret must never reach the
// browser bundle.

export const ADMIN_SESSION_COOKIE = 'zenith_admin_session'
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8 // 8 hours

// Hardcoded owner password for the admin console, as requested. Override it
// in production by setting ADMIN_PASSWORD in the environment (e.g. Vercel /
// Netlify project settings) — the literal string below is only the
// out-of-the-box default and never ships to the client.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Zenith-Atelier-2026!'

// Secret used to derive the session cookie value from the password, so the
// cookie itself is never the plaintext password. Override with
// ADMIN_SESSION_SECRET in production.
const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || 'zenith-vault-admin-session-secret-v1'

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Compares two strings in roughly constant time to avoid leaking length/
 * content via timing side-channels on the password check. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export function verifyAdminPassword(password: string): boolean {
  if (typeof password !== 'string' || password.length === 0) return false
  return timingSafeEqual(password, ADMIN_PASSWORD)
}

/** The signed session token stored in the cookie — derived from the secret,
 * not the password itself, so it can be safely handed to the browser as an
 * httpOnly cookie. */
export async function createSessionToken(): Promise<string> {
  return sha256Hex(`${ADMIN_PASSWORD}::${SESSION_SECRET}`)
}

export async function isValidSessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false
  const expected = await createSessionToken()
  return timingSafeEqual(token, expected)
}

// Minimal in-memory brute-force throttle for the login endpoint. Serverless
// instances are ephemeral so this isn't a durable rate limiter, but it
// meaningfully slows down naive automated password guessing within a warm
// instance without adding external infrastructure.
const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 8
const WINDOW_MS = 5 * 60 * 1000

export function isRateLimited(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > MAX_ATTEMPTS
}
