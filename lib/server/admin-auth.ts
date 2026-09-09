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

/**
 * The configured password, with surrounding whitespace removed.
 *
 * ONE function, used by both the login check and the session fingerprint. If
 * those two read the variable differently — one trimmed, one not — a login
 * would succeed and then mint a token bound to a different fingerprint, and
 * every request after it would be rejected. That is a genuinely confusing
 * failure, so there is exactly one way to read this value.
 *
 * Trimmed because a `.env` file is edited by hand and a stray trailing space
 * is invisible in an editor. This console has already lost an afternoon to an
 * env file that looked correct and was not.
 */
function adminPassword(): string {
  const value = requireEnv('ADMIN_PASSWORD').trim()
  if (!value) {
    throw new Error(
      'ADMIN_PASSWORD is set but empty once trimmed. The admin console has no ' +
        'default credentials — set a real value and redeploy.',
    )
  }
  return value
}

/** True when both variables are present and not blank. Lets a caller answer
 *  503 rather than leak a stack trace when the console is simply not
 *  configured — including the whitespace-only case, which used to read as
 *  "configured" here and then throw further in. */
export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim() && process.env.ADMIN_SESSION_SECRET?.trim())
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
 * Both sides are trimmed, then HASHED, and the comparison runs over the two
 * fixed-length digests.
 *
 * The hashing is not decoration and is deliberately kept rather than replaced
 * with `submitted === process.env.ADMIN_PASSWORD`. A direct string compare
 * returns as soon as two characters differ, so the time it takes reveals how
 * much of the password was right — and it exits immediately on a length
 * mismatch, which hands over the password's length for free. Over a few
 * thousand requests that is a measurable oracle, and this is the only
 * credential guarding the admin console. Digests are always 64 characters, so
 * the loop below always runs the same number of times whatever was submitted.
 *
 * Trimming the submitted value is the convenience: a password pasted from a
 * password manager or typed on a phone keyboard often carries a trailing
 * space, and rejecting it teaches the admin their password is wrong when it
 * is not.
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (typeof password !== 'string') return false
  const submittedRaw = password.trim()
  if (submittedRaw.length === 0) return false

  const [submitted, expected] = await Promise.all([
    sha256Hex(submittedRaw),
    sha256Hex(adminPassword()),
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
  // Same reader as verifyAdminPassword — see adminPassword().
  return (await sha256Hex(adminPassword())).slice(0, 16)
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
