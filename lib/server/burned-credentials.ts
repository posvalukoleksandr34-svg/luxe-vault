import 'server-only'

import { createHash } from 'node:crypto'

/**
 * The admin password and session secret that were once committed as code
 * fallbacks (commit a3aae8f, removed in 9b36bec). The repository is public,
 * so both values are public: anyone who reads the history can sign in to a
 * deployment that still uses them.
 *
 * Kept as SHA-256 digests only — the same ones scripts/verify-security.mjs
 * uses to keep the values out of the source. The values are already public;
 * the digests reveal nothing new.
 *
 * Removing the literals from the code did not change what production runs
 * with: that is whatever Vercel holds. This check is how the console tells
 * its owner, on the dashboard and in the log, when Vercel still holds one of
 * them. It does not refuse the sign-in — that would lock the owner out of
 * the console they need to see the warning — so rotating stays the owner's
 * step (docs/audit/OWNER_APPROVAL_CHECKLIST.md).
 */
const BURNED: Record<'ADMIN_PASSWORD' | 'ADMIN_SESSION_SECRET', string> = {
  ADMIN_PASSWORD: '1f5df87ae46571cc31019912382ad5c6fa03dfa36d760d299bd33ae85957ba04', // gitleaks:allow — digest of a burned credential
  ADMIN_SESSION_SECRET: '88d4708a3ecdf708300363cfbcc05f6729e6fa0c8e34a4614ea9d7aadf1607a1', // gitleaks:allow — digest of a burned credential
}

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

/** The admin variables whose current value is one of the burned ones. */
export function burnedAdminCredentials(
  env: { ADMIN_PASSWORD?: string; ADMIN_SESSION_SECRET?: string } = process.env as { ADMIN_PASSWORD?: string; ADMIN_SESSION_SECRET?: string },
  burned: Record<'ADMIN_PASSWORD' | 'ADMIN_SESSION_SECRET', string> = BURNED,
): ('ADMIN_PASSWORD' | 'ADMIN_SESSION_SECRET')[] {
  const out: ('ADMIN_PASSWORD' | 'ADMIN_SESSION_SECRET')[] = []
  for (const name of ['ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET'] as const) {
    const value = env[name]
    if (!value) continue
    // The password is read trimmed (lib/server/admin-auth.ts); check both forms.
    if (sha256(value) === burned[name] || sha256(value.trim()) === burned[name]) out.push(name)
  }
  return out
}
