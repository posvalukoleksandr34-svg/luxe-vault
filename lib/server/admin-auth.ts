// Server-only helpers for the private admin console. Never import this file
// from a 'use client' component — the password/secret must never reach the
// browser bundle.
//
// Runs on the Edge runtime (middleware.ts imports it), so everything here uses
// Web Crypto rather than node:crypto.

export const ADMIN_SESSION_COOKIE = 'zenith_admin_session'
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8 // 8 hours

/**
 * Credentials. No defaults, deliberately.
 *
 * These used to fall back to string literals committed in this file — an
 * `|| '...'` on each of ADMIN_PASSWORD and ADMIN_SESSION_SECRET. A deploy that
 * forgot the environment variable therefore opened the admin console with a
 * password anyone could read in the repository, and did so silently, which is
 * the worst property a credential can have. The literals are deliberately not
 * repeated here: they are still in the git history, so treat them as burned
 * and never reuse them.
 *
 * Reading them lazily rather than at module scope keeps `next build` working:
 * the build imports this file to compile the middleware, and throwing at
 * import time would fail the build on any machine without the variables set.
 * The throw happens on the first request that actually needs to authenticate,
 * which is the point where failing closed is the correct behaviour.
 */
function requireEnv(name: 'ADMIN_PASSWORD' | 'ADMIN_SESSION_SECRET'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. The admin console has no default credentials — ` +
        'add it to the environment (Vercel → Settings → Environment Variables) and redeploy.',
    )
  }
  return value
}

/** True when both variables are present. Lets a caller answer 503 rather than
 *  leak a stack trace when the console is simply not configured. */
export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET)
}

const encoder = new TextEncoder()

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(input)))
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

/**
 * Constant-time comparison of two equal-length hex strings.
 *
 * Callers must only pass digests, never raw secrets: the length check below
 * returns early and would otherwise leak the password's length. Digests are
 * always the same length, so that path is unreachable for them.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Checks the submitted password.
 *
 * Both sides are hashed first so the comparison runs over two fixed-length
 * digests. Comparing the raw strings would exit on the first length mismatch
 * and hand an attacker the password's length for free.
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) return false
  const [submitted, expected] = await Promise.all([
    sha256Hex(password),
    sha256Hex(requireEnv('ADMIN_PASSWORD')),
  ])
  return timingSafeEqual(submitted, expected)
}

/**
 * Binds a session to the current password without storing it.
 *
 * Included in every token's signed payload, so rotating ADMIN_PASSWORD
 * invalidates every session that was issued under the old one — which is the
 * entire reason to change a password after a suspected leak.
 */
async function passwordFingerprint(): Promise<string> {
  return (await sha256Hex(requireEnv('ADMIN_PASSWORD'))).slice(0, 16)
}

/**
 * A signed session token that expires.
 *
 * The previous token was `sha256(password + secret)` — a constant. It carried
 * no expiry, no nonce and no way to revoke it, so a cookie copied once stayed
 * valid until the password itself changed. The cookie's 8-hour `max-age` was a
 * hint to the browser, not a rule the server enforced; replaying the value
 * after it "expired" worked perfectly.
 *
 * Format: `<expiry-epoch-seconds>.<random-nonce>.<hmac>`. The expiry is inside
 * the signed payload, so the server rejects a stale token no matter what the
 * browser does with the cookie, and the nonce makes two sessions issued in the
 * same second distinct.
 */
export async function createSessionToken(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(12)).buffer)
  const payload = `${expiresAt}.${nonce}`
  const signature = await hmacHex(
    requireEnv('ADMIN_SESSION_SECRET'),
    `${payload}.${await passwordFingerprint()}`,
  )
  return `${payload}.${signature}`
}

export async function isValidSessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 3) return false

  const [expiresRaw, nonce, signature] = parts

  const expiresAt = Number(expiresRaw)
  if (!Number.isFinite(expiresAt)) return false
  // Checked before the HMAC so an expired token costs nothing to reject.
  if (expiresAt * 1000 <= Date.now()) return false

  let expected: string
  try {
    expected = await hmacHex(
      requireEnv('ADMIN_SESSION_SECRET'),
      `${expiresRaw}.${nonce}.${await passwordFingerprint()}`,
    )
  } catch {
    // Not configured. Fail closed rather than throwing out of middleware.
    return false
  }

  return timingSafeEqual(signature, expected)
}
