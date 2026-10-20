import 'server-only'

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

/**
 * Staff passphrases (admin_staff.passphrase_hash, migration 0059).
 *
 * scrypt from node:crypto — memory-hard, no dependency — encoded as
 * `scrypt$N$r$p$salt$hash` (base64url), so the cost can be raised later and
 * old hashes still verify with the parameters they were made with.
 *
 * A passphrase here is the SECOND thing a staff member proves: the console's
 * shared password and TOTP code come first (app/api/admin/login). It answers
 * "which of you is this", so a decision has a person behind it and a second
 * approval can be required to come from somebody else.
 */

const N = 2 ** 15
const R = 8
const P = 1
const KEY_LENGTH = 32
/** scrypt needs 128·N·r bytes; Node's default ceiling (32 MiB) is exactly that. */
const MAX_MEM = 64 * 1024 * 1024

export const PASSPHRASE_MIN = 12
export const PASSPHRASE_MAX = 200

function derive(passphrase: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(passphrase.normalize('NFKC'), salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    )
  })
}

/** Why a passphrase is refused, or null. Length is the rule that matters. */
export function passphraseProblem(passphrase: string): 'too_short' | 'too_long' | null {
  const length = Array.from(passphrase.normalize('NFKC')).length
  if (length < PASSPHRASE_MIN) return 'too_short'
  if (length > PASSPHRASE_MAX) return 'too_long'
  return null
}

export async function hashPassphrase(passphrase: string): Promise<string> {
  const problem = passphraseProblem(passphrase)
  if (problem) throw new RangeError(`passphrase ${problem}`)
  const salt = randomBytes(16)
  const key = await derive(passphrase, salt, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/**
 * Constant-time check. A malformed stored hash is a NO, never an exception a
 * caller might treat as "skip the check".
 */
export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [n, r, p] = parts.slice(1, 4).map(Number)
  if (![n, r, p].every((v) => Number.isSafeInteger(v) && v > 0) || n > 2 ** 20) return false
  const salt = Buffer.from(parts[4], 'base64url')
  const expected = Buffer.from(parts[5], 'base64url')
  if (salt.length < 8 || expected.length !== KEY_LENGTH) return false
  if (passphrase.length === 0 || passphrase.length > PASSPHRASE_MAX * 4) return false
  try {
    const key = await derive(passphrase, salt, n, r, p)
    return timingSafeEqual(key, expected)
  } catch {
    return false
  }
}
