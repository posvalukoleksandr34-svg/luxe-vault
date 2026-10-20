import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import type { TrackingSnapshot } from '@/lib/refunds/delivery'
import type { Actor, EvidenceKind } from '@/lib/refunds/types'
import { actorId } from '@/lib/refunds/types'
import { matchesDeclaredType } from '@/lib/server/file-signature'
import { audit } from '@/lib/server/refunds/audit'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Evidence on a case: photographs, documents, tracking snapshots, the order's
 * own record — each with WHERE it came from and WHEN it was observed.
 *
 * Files live in private buckets ('returns' for the customer's photos,
 * 'refund-evidence' for staff uploads) and are only ever served through a
 * signed URL a few minutes long, minted by a staff route that writes an audit
 * row naming who looked. Every file is hashed (SHA-256) on the way in, which
 * is how the same photograph turning up on another case is noticed — a fact
 * for a person to weigh, never proof of anything by itself.
 *
 * Rows are append-only (refund_case_evidence_guard): the only change allowed
 * is the retention purge, which deletes the file and keeps the row as a
 * record that it existed.
 */

export type EvidenceRecord = {
  id: string
  caseId: string
  kind: EvidenceKind
  source: 'customer' | 'staff' | 'system' | 'carrier_api'
  title?: string
  bucket?: string
  path?: string
  mimeType?: string
  sizeBytes?: number
  sha256?: string
  data: Record<string, unknown>
  customerVisible: boolean
  capturedAt: number
  recordedAt: number
  recordedByLabel: string
  purgedAt?: number
}

const ms = (v: unknown): number | undefined => (typeof v === 'string' && v ? Date.parse(v) : undefined)

function toEvidence(r: Record<string, unknown>): EvidenceRecord {
  return {
    id: r.id as string,
    caseId: r.case_id as string,
    kind: r.kind as EvidenceKind,
    source: r.source as EvidenceRecord['source'],
    title: (r.title as string | null) ?? undefined,
    bucket: (r.storage_bucket as string | null) ?? undefined,
    path: (r.storage_path as string | null) ?? undefined,
    mimeType: (r.mime_type as string | null) ?? undefined,
    sizeBytes: r.size_bytes === null ? undefined : Number(r.size_bytes),
    sha256: (r.sha256 as string | null) ?? undefined,
    data: (r.data as Record<string, unknown>) ?? {},
    customerVisible: Boolean(r.customer_visible),
    capturedAt: Date.parse(r.captured_at as string),
    recordedAt: Date.parse(r.recorded_at as string),
    recordedByLabel: r.recorded_by_label as string,
    purgedAt: ms(r.purged_at),
  }
}

export async function listEvidence(caseId: string, opts: { customerVisibleOnly?: boolean } = {}): Promise<EvidenceRecord[]> {
  let q = createAdminClient().from('refund_case_evidence').select('*').eq('case_id', caseId).order('recorded_at')
  if (opts.customerVisibleOnly) q = q.eq('customer_visible', true)
  const { data, error } = await q
  if (error) throw new Error(`Failed to read evidence: ${error.message}`)
  return (data ?? []).map((r) => toEvidence(r as Record<string, unknown>))
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function insertEvidence(row: Record<string, unknown>): Promise<EvidenceRecord> {
  const { data, error } = await createAdminClient().from('refund_case_evidence').insert(row).select('*').single()
  if (error) throw new Error(`Failed to record evidence: ${error.message}`)
  return toEvidence(data as Record<string, unknown>)
}

/**
 * The customer's own photographs, already uploaded to 'returns' under their
 * id (app/api/returns/upload). Each is read back once to hash it; a path that
 * is not theirs never reaches here (the route checks the prefix).
 */
export async function registerCustomerPhotos(caseId: string, paths: string[], customer: Actor): Promise<EvidenceRecord[]> {
  const out: EvidenceRecord[] = []
  const storage = createAdminClient().storage.from('returns')
  for (const path of paths) {
    const { data: blob, error } = await storage.download(path)
    if (error || !blob) throw new Error(`Photo ${path} could not be read: ${error?.message ?? 'missing'}`)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    out.push(
      await insertEvidence({
        case_id: caseId,
        kind: 'customer_photo',
        source: 'customer',
        storage_bucket: 'returns',
        storage_path: path,
        mime_type: blob.type || null,
        size_bytes: bytes.length,
        sha256: sha256(bytes),
        customer_visible: true,
        recorded_by_label: customer.label,
      }),
    )
  }
  return out
}

export const STAFF_EVIDENCE_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['application/pdf', 'pdf'],
])
export const STAFF_EVIDENCE_MAX_BYTES = 4 * 1024 * 1024

export type UploadRefusal = 'type' | 'empty' | 'too_large'

/** A file staff attach: a carrier letter, a proof-of-delivery PDF, a photo of what arrived. */
export async function uploadStaffEvidence(input: {
  caseId: string
  orderId: string
  bytes: Uint8Array
  mimeType: string
  kind: EvidenceKind
  title?: string
  capturedAt?: number
  customerVisible?: boolean
  actor: Extract<Actor, { type: 'staff' }>
}): Promise<{ ok: true; evidence: EvidenceRecord } | { ok: false; refusal: UploadRefusal }> {
  const ext = STAFF_EVIDENCE_TYPES.get(input.mimeType.toLowerCase())
  if (!ext || !matchesDeclaredType(input.bytes, input.mimeType)) return { ok: false, refusal: 'type' }
  if (input.bytes.length === 0) return { ok: false, refusal: 'empty' }
  if (input.bytes.length > STAFF_EVIDENCE_MAX_BYTES) return { ok: false, refusal: 'too_large' }

  const path = `cases/${input.caseId}/${randomUUID()}.${ext}`
  const { error } = await createAdminClient()
    .storage.from('refund-evidence')
    .upload(path, input.bytes, { contentType: input.mimeType, upsert: false })
  if (error) throw new Error(`Evidence upload failed: ${error.message}`)

  const evidence = await insertEvidence({
    case_id: input.caseId,
    kind: input.kind,
    source: 'staff',
    title: input.title?.slice(0, 200) ?? null,
    storage_bucket: 'refund-evidence',
    storage_path: path,
    mime_type: input.mimeType,
    size_bytes: input.bytes.length,
    sha256: sha256(input.bytes),
    customer_visible: Boolean(input.customerVisible),
    captured_at: new Date(input.capturedAt ?? Date.now()).toISOString(),
    recorded_by: actorId(input.actor),
    recorded_by_label: input.actor.label,
  })
  await audit({
    actor: input.actor,
    action: 'evidence.recorded',
    caseId: input.caseId,
    orderId: input.orderId,
    data: { evidenceId: evidence.id, kind: input.kind, sha256: evidence.sha256, sizeBytes: evidence.sizeBytes },
  })
  return { ok: true, evidence }
}

/**
 * A tracking snapshot, as read off the carrier's page by staff (source
 * 'staff', with when they looked) or derived from the order's own record
 * (source 'system'). Fields the source did not give stay absent.
 */
export async function recordTrackingSnapshot(input: {
  caseId: string
  orderId: string
  snapshot: TrackingSnapshot
  actor: Actor
  note?: string
}): Promise<EvidenceRecord> {
  const evidence = await insertEvidence({
    case_id: input.caseId,
    kind: 'tracking_snapshot',
    source: input.snapshot.source,
    title: input.note?.slice(0, 200) ?? null,
    data: input.snapshot,
    customer_visible: false,
    captured_at: new Date(input.snapshot.retrievedAt).toISOString(),
    recorded_by: actorId(input.actor),
    recorded_by_label: input.actor.label,
  })
  await audit({
    actor: input.actor,
    action: 'evidence.tracking_snapshot',
    caseId: input.caseId,
    orderId: input.orderId,
    data: { evidenceId: evidence.id, status: input.snapshot.status, source: input.snapshot.source },
  })
  return evidence
}

/** The shop's own record of the shipment, captured when a case opens. */
export async function recordOrderRecord(caseId: string, record: Record<string, unknown>): Promise<EvidenceRecord> {
  return insertEvidence({
    case_id: caseId,
    kind: 'order_event',
    source: 'system',
    title: 'Order record at the time of the claim',
    data: record,
    customer_visible: false,
    recorded_by_label: 'system',
  })
}

/** Snapshots for the advice engine, newest first. */
export async function latestTrackingSnapshot(caseId: string): Promise<TrackingSnapshot | undefined> {
  const { data, error } = await createAdminClient()
    .from('refund_case_evidence')
    .select('data')
    .eq('case_id', caseId)
    .eq('kind', 'tracking_snapshot')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to read tracking evidence: ${error.message}`)
  return (data?.data as TrackingSnapshot | undefined) ?? undefined
}

/** How many of this case's files also appear on OTHER cases. */
export async function duplicateEvidenceCount(caseId: string): Promise<number> {
  const admin = createAdminClient()
  const { data: mine, error } = await admin
    .from('refund_case_evidence')
    .select('sha256')
    .eq('case_id', caseId)
    .not('sha256', 'is', null)
  if (error) throw new Error(`Failed to read evidence hashes: ${error.message}`)
  const hashes = Array.from(new Set((mine ?? []).map((r) => r.sha256 as string)))
  if (hashes.length === 0) return 0
  const { data: elsewhere, error: e2 } = await admin
    .from('refund_case_evidence')
    .select('sha256')
    .in('sha256', hashes)
    .neq('case_id', caseId)
  if (e2) throw new Error(`Failed to compare evidence hashes: ${e2.message}`)
  return new Set((elsewhere ?? []).map((r) => r.sha256 as string)).size
}

/**
 * A short-lived link to one file, for staff — and an audit row saying who
 * opened it. A customer reaches their own photos through their own route.
 */
export async function signEvidence(evidenceId: string, actor: Actor, seconds = 300): Promise<{ url: string; evidence: EvidenceRecord } | null> {
  const { data, error } = await createAdminClient().from('refund_case_evidence').select('*').eq('id', evidenceId).maybeSingle()
  if (error) throw new Error(`Failed to read evidence: ${error.message}`)
  if (!data) return null
  const evidence = toEvidence(data as Record<string, unknown>)
  if (!evidence.bucket || !evidence.path || evidence.purgedAt) return null
  const { data: signed, error: signError } = await createAdminClient()
    .storage.from(evidence.bucket)
    .createSignedUrl(evidence.path, seconds)
  if (signError || !signed?.signedUrl) throw new Error(`Failed to sign evidence: ${signError?.message ?? 'no url'}`)
  await audit({ actor, action: 'evidence.viewed', caseId: evidence.caseId, data: { evidenceId, kind: evidence.kind } })
  return { url: signed.signedUrl, evidence }
}

/**
 * Retention: files of cases CLOSED longer than `days` ago are deleted from
 * storage; the rows stay, marked purged, so the history still says what was
 * there. Cases with an open dispute, or an abuse finding, are kept (a
 * documented finding is the shop's defence later). Returns how many files.
 */
export async function purgeExpiredEvidence(days: number, limit = 200): Promise<number> {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data: cases, error } = await admin
    .from('return_requests')
    .select('id, order_id')
    .not('closed_at', 'is', null)
    .lt('closed_at', cutoff)
    .is('evidence_purged_at', null)
    .not('state', 'eq', 'disputed')
    .or('finding.is.null,finding.neq.abuse_confirmed')
    .limit(50)
  if (error) throw new Error(`Failed to find cases past retention: ${error.message}`)

  let purged = 0
  for (const c of cases ?? []) {
    const { data: files, error: fe } = await admin
      .from('refund_case_evidence')
      .select('id, storage_bucket, storage_path')
      .eq('case_id', c.id)
      .not('storage_path', 'is', null)
      .is('purged_at', null)
      .limit(limit)
    if (fe) throw new Error(`Failed to list evidence for purge: ${fe.message}`)
    const byBucket = new Map<string, string[]>()
    for (const f of files ?? []) {
      const list = byBucket.get(f.storage_bucket as string) ?? []
      list.push(f.storage_path as string)
      byBucket.set(f.storage_bucket as string, list)
    }
    for (const [bucket, paths] of Array.from(byBucket.entries())) {
      const { error: re } = await admin.storage.from(bucket).remove(paths)
      if (re) throw new Error(`Failed to delete evidence files: ${re.message}`)
    }
    const now = new Date().toISOString()
    for (const f of files ?? []) {
      const { error: ue } = await admin
        .from('refund_case_evidence')
        .update({ purged_at: now, storage_path: null })
        .eq('id', f.id)
      if (ue) throw new Error(`Failed to mark evidence purged: ${ue.message}`)
      purged++
    }
    const { error: ce } = await admin
      .from('return_requests')
      .update({ evidence_purged_at: now, images: [] })
      .eq('id', c.id)
    if (ce) throw new Error(`Failed to mark the case purged: ${ce.message}`)
    await audit({
      actor: { type: 'system', label: 'retention' },
      action: 'evidence.purged',
      caseId: c.id as string,
      orderId: c.order_id as string,
      data: { files: (files ?? []).length, retentionDays: days },
    })
  }
  return purged
}
