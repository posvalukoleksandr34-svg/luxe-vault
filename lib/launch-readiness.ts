/**
 * The launch-readiness checks the owner's console shows (/admin/launch), as
 * data. The server gathers them (lib/server/launch-readiness.ts); this file is
 * the shapes and the pure judgements, testable without a server.
 *
 * A check reports only what the running application can SEE for itself — its
 * own configuration, its database, the record of the backup workflows. What
 * it cannot see (a lawyer's opinion, a payment provider's acceptance, the
 * hosting plan) is listed as an owner item with the checklist reference, and
 * never shown as done.
 */

export type CheckStatus =
  /** Verified by the application itself. */
  | 'ok'
  /** Verified, and it blocks a lawful, safe launch. */
  | 'blocked'
  /** Verified, worth fixing, does not block on its own. */
  | 'warning'
  /** Could not be determined from here (a read failed). */
  | 'unknown'
  /** Only the owner (or counsel, or a provider) can establish it. */
  | 'owner'

export type ReadinessCheck = {
  id: string
  area: 'sales' | 'legal' | 'security' | 'payments' | 'database' | 'backups' | 'operations' | 'catalogue'
  title: string
  status: CheckStatus
  /** What was found, in plain words. Never a secret value. */
  detail: string
  /** What to do, and where. */
  action?: string
  /** The OWNER_APPROVAL_CHECKLIST.md item, when there is one. */
  ref?: string
}

/** One GitHub Actions run, as the public API returns it (the fields used). */
export type WorkflowRun = {
  status: string
  conclusion: string | null
  created_at: string
  head_branch?: string
}

export type WorkflowVerdict = {
  status: CheckStatus
  lastSuccessAt: number | null
  lastRunAt: number | null
  lastConclusion: string | null
}

/**
 * Judges a backup workflow from its runs: 'ok' only when it SUCCEEDED within
 * `maxAgeHours`. A run that was merely scheduled, or green long ago, is not a
 * backup now. No runs at all is 'blocked' (nothing has ever succeeded).
 */
export function judgeWorkflowRuns(runs: WorkflowRun[], maxAgeHours: number, now = Date.now()): WorkflowVerdict {
  const completed = runs
    .filter((r) => r.status === 'completed')
    .map((r) => ({ at: Date.parse(r.created_at), conclusion: r.conclusion }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => b.at - a.at)
  const last = completed[0] ?? null
  const lastSuccess = completed.find((r) => r.conclusion === 'success') ?? null
  const fresh = lastSuccess !== null && now - lastSuccess.at <= maxAgeHours * 3_600_000
  return {
    status: fresh ? 'ok' : 'blocked',
    lastSuccessAt: lastSuccess?.at ?? null,
    lastRunAt: last?.at ?? null,
    lastConclusion: last?.conclusion ?? null,
  }
}

/** Which Stripe mode a secret key is for, from its documented prefix only. */
export function stripeKeyMode(key: string | undefined): 'live' | 'test' | 'missing' | 'unrecognised' {
  const k = (key ?? '').trim()
  if (!k) return 'missing'
  if (/^(sk|rk)_live_/.test(k)) return 'live'
  if (/^(sk|rk)_test_/.test(k)) return 'test'
  return 'unrecognised'
}

/** The order the console lists them in: what blocks first. */
const RANK: Record<CheckStatus, number> = { blocked: 0, unknown: 1, owner: 2, warning: 3, ok: 4 }

export function sortChecks(checks: ReadinessCheck[]): ReadinessCheck[] {
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => RANK[a.c.status] - RANK[b.c.status] || a.i - b.i)
    .map((x) => x.c)
}

export function summarise(checks: ReadinessCheck[]): Record<CheckStatus, number> {
  const out: Record<CheckStatus, number> = { ok: 0, blocked: 0, warning: 0, unknown: 0, owner: 0 }
  for (const c of checks) out[c.status]++
  return out
}
