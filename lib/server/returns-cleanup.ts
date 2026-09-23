import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Removes return photographs that no request points at.
 *
 * A photo is uploaded the moment a customer chooses it, before the request is
 * filed (app/api/returns/upload). One that is then removed from the form, or
 * left behind when the form is abandoned, is never referenced by anything.
 * It is harmless — private, under its uploader's own prefix — but it is a
 * picture of someone's property kept for no reason, and it costs storage.
 *
 * THIS DELETES PERMANENTLY, so every rule below leans towards keeping:
 *
 *   * THE REFERENCED SET MUST BE COMPLETE. It is read page by page until
 *     exhausted, and ANY failure aborts the whole run before a single
 *     deletion. This is the rule that matters: a read that failed, or stopped
 *     early, would make every photo look orphaned, and the sweep would wipe
 *     the evidence behind every open return. Incompleteness on the other side
 *     — a bucket listing that misses some objects — only means fewer
 *     deletions, which is the safe direction.
 *
 *   * EVERY REQUEST COUNTS, whatever its status. A rejected or completed
 *     return's photos are the record of why it was decided that way.
 *
 *   * A DAY'S GRACE. Anything younger than GRACE_MS is left, so a customer
 *     midway through the form never loses a picture they are about to submit.
 *     An object with no creation time is left too.
 *
 *   * A CEILING PER RUN. At most MAX_DELETES objects go per night, so a large
 *     backlog finishes over several nights rather than running the sweep past
 *     its time limit and taking the other jobs with it.
 */

const BUCKET = 'returns'
/** Where the upload route puts everything: returns/<customer id>/<file>. */
const ROOT = 'returns'

export const GRACE_MS = 24 * 60 * 60 * 1000
const MAX_DELETES = 500
const PAGE = 1000

export type StoredPhoto = { path: string; createdAt: number | null }

/**
 * Which of `objects` may be deleted. Pure, so the rule can be read — and
 * tested — without a bucket.
 */
export function selectOrphans(
  objects: StoredPhoto[],
  referenced: Set<string>,
  now: number,
  graceMs: number = GRACE_MS,
): string[] {
  return objects
    .filter((o) => !referenced.has(o.path))
    .filter((o) => o.createdAt !== null && now - o.createdAt >= graceMs)
    .map((o) => o.path)
}

/** Every photo path any return request points at. Throws rather than
 *  answering partially — see the first rule above. */
async function readReferencedPaths(): Promise<Set<string>> {
  const supabase = createAdminClient()
  const referenced = new Set<string>()

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('return_requests')
      .select('images')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`could not read return requests: ${error.message}`)
    for (const row of data ?? []) {
      const images = (row as { images?: unknown }).images
      if (Array.isArray(images)) for (const path of images) if (typeof path === 'string') referenced.add(path)
    }
    if (!data || data.length < PAGE) break
  }
  return referenced
}

/** Everything in the bucket, as full paths. Storage lists one folder at a
 *  time, so this walks returns/ and then each customer's folder, paging
 *  both — the default page is 100, which would quietly miss the rest. */
async function listStoredPhotos(): Promise<StoredPhoto[]> {
  const storage = createAdminClient().storage.from(BUCKET)

  const listAll = async (prefix: string) => {
    const entries: { name: string; id: string | null; created_at?: string | null }[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await storage.list(prefix, { limit: PAGE, offset })
      if (error) throw new Error(`could not list ${prefix}: ${error.message}`)
      entries.push(...((data ?? []) as typeof entries))
      if (!data || data.length < PAGE) break
    }
    return entries
  }

  const photos: StoredPhoto[] = []
  // A folder comes back with a null id; a file has one.
  for (const folder of (await listAll(ROOT)).filter((e) => e.id === null)) {
    const prefix = `${ROOT}/${folder.name}`
    for (const file of (await listAll(prefix)).filter((e) => e.id !== null)) {
      const created = file.created_at ? Date.parse(file.created_at) : NaN
      photos.push({ path: `${prefix}/${file.name}`, createdAt: Number.isFinite(created) ? created : null })
    }
  }
  return photos
}

export type CleanupResult = {
  scanned: number
  referenced: number
  orphaned: number
  deleted: number
}

/**
 * One night's cleanup.
 *
 * `dryRun` reports what WOULD go without removing anything — the way to see
 * the rule's verdict against the real bucket before trusting it.
 */
export async function sweepOrphanedReturnPhotos(options: { dryRun?: boolean } = {}): Promise<CleanupResult> {
  // Referenced FIRST, and fully: if this throws, nothing below runs.
  const referenced = await readReferencedPaths()
  const stored = await listStoredPhotos()

  const orphans = selectOrphans(stored, referenced, Date.now())
  const result: CleanupResult = {
    scanned: stored.length,
    referenced: referenced.size,
    orphaned: orphans.length,
    deleted: 0,
  }
  if (options.dryRun || orphans.length === 0) return result

  const storage = createAdminClient().storage.from(BUCKET)
  const batch = orphans.slice(0, MAX_DELETES)
  for (let i = 0; i < batch.length; i += 100) {
    const chunk = batch.slice(i, i + 100)
    const { data, error } = await storage.remove(chunk)
    if (error) throw new Error(`removed ${result.deleted}, then failed: ${error.message}`)
    result.deleted += data?.length ?? 0
  }
  return result
}
