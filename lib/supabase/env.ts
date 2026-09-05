/**
 * Supabase environment, validated at the point of use.
 *
 * Both public values are safe in the browser: the anon/publishable key is the
 * public key, and every query it makes is constrained by RLS. The service-role
 * key is never read here — it belongs only in server-only modules.
 *
 * Deliberately does NOT throw at module load. The middleware runs on every
 * request, so a hard throw here would take the entire site down (including
 * /admin, which does not use Supabase at all) the moment a key is missing.
 * Callers that genuinely need Supabase call `requireSupabaseEnv()` and get a
 * precise error; the middleware checks `isSupabaseConfigured` and skips.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** Hosted Supabase project refs are exactly 20 lowercase alphanumerics. */
const HOSTED_REF = /^[a-z0-9]{20,22}$/

/**
 * Explains what is wrong with a configured URL, or null if it looks usable.
 *
 * This exists because the failure it catches is otherwise invisible: a URL
 * with a typo'd project ref resolves to nothing, and the browser reports the
 * result only as `TypeError: Failed to fetch` — no status, no hostname, no
 * hint that the cause is configuration rather than code.
 */
export function describeUrlProblem(value: string): string | null {
  if (/["']/.test(value)) {
    return 'it is wrapped in quotes — .env values must be bare, e.g. NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co'
  }
  if (/[<>]/.test(value)) {
    return 'it still contains a placeholder like <your-project-ref>'
  }
  if (/\s/.test(value)) return 'it contains whitespace'

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return `"${value}" is not a valid URL (it must start with https://)`
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    return `the protocol is "${parsed.protocol}" — hosted Supabase requires https://`
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return `it has a path ("${parsed.pathname}") — use only the origin, with no /rest/v1 or trailing path`
  }

  // Only enforced for hosted projects; self-hosted instances use any hostname.
  if (parsed.hostname.endsWith('.supabase.co')) {
    const ref = parsed.hostname.split('.')[0]
    if (!HOSTED_REF.test(ref)) {
      return (
        `the project ref "${ref}" is ${ref.length} characters, but Supabase refs are ` +
        'exactly 20 lowercase letters/digits. That hostname will not resolve, and the ' +
        'browser will report it only as "Failed to fetch". Copy the exact Project URL ' +
        'from Supabase → Project Settings → API.'
      )
    }
  }
  return null
}

export function requireSupabaseEnv(): { url: string; anonKey: string } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const missing = [
      !SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
      !SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ]
      .filter(Boolean)
      .join(' and ')
    throw new Error(
      `Supabase is not configured: ${missing} missing. Copy them from ` +
        'Supabase → Project Settings → API into .env.local, then restart the dev server.',
    )
  }

  const problem = describeUrlProblem(SUPABASE_URL)
  if (problem) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is unusable: ${problem}`)
  }

  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
}
