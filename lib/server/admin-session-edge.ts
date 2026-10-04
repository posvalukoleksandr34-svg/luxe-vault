// Whether an admin session is still live — the Edge middleware's version of
// admin-sessions.ts. Runs in the Edge runtime: fetch() against Supabase's REST
// API, no supabase-js, no node:* modules.
//
// WHY THE MIDDLEWARE ASKS TOO. Every admin handler and page already checks
// revocation (admin-guard.ts), so a revoked token never reads or writes data.
// But the middleware used to pass any correctly SIGNED token, and a page then
// redirected from inside its render — by which time Next had started
// streaming, so the answer was a 200 carrying a client-side redirect. Asked
// here, a signed-out token is turned away before anything renders: a real 307
// for pages, a 401 for the API.
//
// Answers mirror admin-sessions.ts: 'active', 'refused' (unknown, revoked,
// expired, or the database could not be read — fail closed), 'unmigrated'
// (table missing: the handlers' fallback applies), and 'unconfigured' (no
// Supabase credentials in this runtime: leave the decision to the handlers,
// which fail closed without them).

export type EdgeSessionState = 'active' | 'refused' | 'unmigrated' | 'unconfigured'

const TIMEOUT_MS = 3000

export async function edgeSessionState(nonce: string): Promise<EdgeSessionState> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!base || !key) return 'unconfigured'
  if (!/^[0-9a-f]{24}$/.test(nonce)) return 'refused'

  try {
    const res = await fetch(
      `${base.replace(/\/$/, '')}/rest/v1/admin_sessions?nonce=eq.${nonce}&select=expires_at,revoked_at`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      if (res.status === 404 || body?.code === 'PGRST205' || body?.code === '42P01') return 'unmigrated'
      return 'refused'
    }
    const rows = (await res.json()) as { expires_at: string; revoked_at: string | null }[]
    const row = Array.isArray(rows) ? rows[0] : undefined
    if (!row || row.revoked_at) return 'refused'
    return Date.parse(row.expires_at) > Date.now() ? 'active' : 'refused'
  } catch {
    return 'refused'
  }
}
