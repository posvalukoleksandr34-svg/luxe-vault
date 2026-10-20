import 'server-only'

import { DEFAULT_POLICY, DEFAULT_POLICY_VERSION, parsePolicyConfig, policyConfigSchema, type PolicyVersion } from '@/lib/refunds/policy'
import type { Actor } from '@/lib/refunds/types'
import { audit } from '@/lib/server/refunds/audit'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The refund policy in force (public.refund_policies, versioned).
 *
 * Version 0 is the default in lib/refunds/policy.ts, drawn from the published
 * Refund Policy; it is never stored. Each save is a NEW row with the next
 * version number — rows are never edited — and every case records the version
 * it was judged under, so a later change cannot rewrite how an earlier case
 * was decided.
 *
 * A stored version that no longer parses (a field renamed in code, say) is
 * read through parsePolicyConfig, which fills what is missing with defaults;
 * one that is outright invalid fails LOUDLY rather than silently falling back
 * to the default — a policy the owner set must not quietly stop applying.
 */

export async function activePolicy(): Promise<PolicyVersion> {
  const { data, error } = await createAdminClient()
    .from('refund_policies')
    .select('version, config')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to read the refund policy: ${error.message}`)
  if (!data) return { version: DEFAULT_POLICY_VERSION, config: DEFAULT_POLICY }
  return { version: Number(data.version), config: parsePolicyConfig(data.config) }
}

export async function policyVersion(version: number): Promise<PolicyVersion> {
  if (version === DEFAULT_POLICY_VERSION) return { version, config: DEFAULT_POLICY }
  const { data, error } = await createAdminClient()
    .from('refund_policies')
    .select('version, config')
    .eq('version', version)
    .maybeSingle()
  if (error) throw new Error(`Failed to read refund policy v${version}: ${error.message}`)
  if (!data) throw new Error(`Refund policy v${version} does not exist`)
  return { version, config: parsePolicyConfig(data.config) }
}

export type PolicyHistoryEntry = { version: number; note?: string; createdAt: number; createdBy: string }

export async function policyHistory(limit = 30): Promise<PolicyHistoryEntry[]> {
  const { data, error } = await createAdminClient()
    .from('refund_policies')
    .select('version, note, created_at, created_by_label')
    .order('version', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Failed to read refund policy history: ${error.message}`)
  return (data ?? []).map((row) => ({
    version: Number(row.version),
    note: (row.note as string | null) ?? undefined,
    createdAt: Date.parse(row.created_at as string),
    createdBy: row.created_by_label as string,
  }))
}

/**
 * Saves a new version. `basedOn` is the version the editor was showing: if
 * someone saved in between, this refuses (409 upstream) instead of
 * overwriting their change with a stale copy.
 */
export async function savePolicy(
  raw: unknown,
  meta: { basedOn: number; note?: string },
  by: Extract<Actor, { type: 'staff' }>,
): Promise<{ ok: true; version: number } | { ok: false; reason: 'stale' | 'invalid'; issues?: string[] }> {
  const parsed = policyConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) }
  }
  const current = await activePolicy()
  if (current.version !== meta.basedOn) return { ok: false, reason: 'stale' }
  const version = current.version + 1
  const { error } = await createAdminClient().from('refund_policies').insert({
    version,
    config: parsed.data,
    note: meta.note?.trim().slice(0, 500) || null,
    created_by: by.staffId,
    created_by_label: by.label,
  })
  // 23505: someone else took this version number in the same instant.
  if (error?.code === '23505') return { ok: false, reason: 'stale' }
  if (error) throw new Error(`Failed to save the refund policy: ${error.message}`)
  await audit({ actor: by, action: 'policy.saved', data: { version, basedOn: meta.basedOn }, reason: meta.note ?? null })
  return { ok: true, version }
}
