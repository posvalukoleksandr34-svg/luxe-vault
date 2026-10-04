import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The admin console's second factor: a 6-digit time-based code (TOTP, RFC
 * 6238 — SHA-1, 30-second steps), the kind every authenticator app shows.
 *
 * The shared password alone is one secret that leaks in one place. With
 * ADMIN_TOTP_SECRET set, signing in also needs the code from the phone the
 * secret was enrolled on (scripts/admin-totp-setup.mjs prints it as a QR code).
 *
 * REPLAY. A code stays valid for its whole step, and one step either side is
 * accepted for clock drift, so a code seen over a shoulder or in a proxy log
 * could be replayed for up to 90 seconds. Each accepted step is therefore
 * recorded (public.admin_totp_steps, migration 0049) and never accepted again.
 *
 * Off until ADMIN_TOTP_SECRET is set, so deploying this does not lock anyone
 * out; production logs a warning on every sign-in while it is off.
 */

const STEP_SECONDS = 30
const DIGITS = 6
/** Steps either side of now that are accepted, for clock drift. */
const DRIFT = 1

const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

function secret(): Buffer | null {
  const raw = process.env.ADMIN_TOTP_SECRET?.replace(/\s+/g, '').toUpperCase()
  if (!raw) return null
  const key = base32Decode(raw)
  return key && key.length >= 10 ? key : null
}

export function isTotpConfigured(): boolean {
  return secret() !== null
}

/** RFC 4648 base32 (what authenticator apps use), padding optional. */
export function base32Decode(input: string): Buffer | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of input.replace(/=+$/, '')) {
    const index = alphabet.indexOf(char)
    if (index === -1) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** The code for one time step (RFC 4226 HOTP over the step counter). */
export function totpAt(key: Buffer, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', key).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** The step the code belongs to, within the drift window — or null. */
export function matchingStep(key: Buffer, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const current = Math.floor(now / 1000 / STEP_SECONDS)
  let found: number | null = null
  // Every candidate is compared (no early exit), so the time taken does not
  // say which step — if any — matched.
  for (let step = current - DRIFT; step <= current + DRIFT; step++) {
    if (timingSafeEqual(Buffer.from(totpAt(key, step)), Buffer.from(code))) found = step
  }
  return found
}

/**
 * Checks a submitted code and spends it.
 *
 * 'ok'          valid, and its step had not been used before (now it has).
 * 'invalid'     wrong, malformed, outside the window, or already used.
 * 'unconfigured' no ADMIN_TOTP_SECRET: the caller signs in on the password alone.
 */
export async function checkTotp(code: unknown): Promise<'ok' | 'invalid' | 'unconfigured'> {
  const key = secret()
  if (!key) return 'unconfigured'
  const step = typeof code === 'string' ? matchingStep(key, code.replace(/\s+/g, '')) : null
  if (step === null) return 'invalid'

  const { error } = await createAdminClient().from('admin_totp_steps').insert({ step })
  if (!error) return 'ok'
  // 23505: this step was already used — a replay.
  if (error.code === '23505') return 'invalid'
  if (MISSING_TABLE.has(error.code)) {
    console.error('[admin-totp] public.admin_totp_steps is missing — apply migration 0049. Codes can be replayed until then.')
    return 'ok'
  }
  throw new Error(`Failed to record the admin code: ${error.message}`)
}
