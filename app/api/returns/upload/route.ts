import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

import { matchesDeclaredType } from '@/lib/server/file-signature'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * One photograph for a return request, into the private 'returns' bucket.
 *
 * WHY A ROUTE AND NOT A DIRECT UPLOAD. Migration 0039 gave the bucket no
 * storage policies at all, so only the service role can write to it — a
 * browser holding the anon key cannot, and should not: these are pictures of
 * a customer's property, and a policy loose enough to let a browser write
 * would be one bug away from letting it read. This route is the only door.
 *
 * ONE FILE PER REQUEST. The platform refuses request bodies above ~4.5 MB,
 * and a phone photo alone is 3–8 MB. The modal downscales before sending
 * (prepareAttachment, the same one the support form uses) and sends photos
 * one at a time, so no single request carries more than one picture.
 *
 * WHAT IS CHECKED, and why each:
 *   * signed in — a return belongs to an account, and so does its evidence
 *   * rate limited — storage costs money and a route that accepts files is
 *     otherwise a free file host
 *   * type AND first bytes — the browser's declared type is only a claim; an
 *     HTML file renamed photo.png arrives as image/png (file-signature.ts)
 *   * size — under the body limit, and under the bucket's own 10 MB
 *
 * The object is keyed under the customer's own id: returns/<user>/<random>.
 * That prefix is what the return-request route checks, so a customer can only
 * attach photographs they uploaded themselves — never another customer's path
 * copied from somewhere. The name is random, so paths cannot be guessed.
 *
 * It answers with the PATH, not a URL. The bucket is private; the modal shows
 * its own local preview, and the manager's view signs a URL when it needs one.
 */

const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
])

/** Under the ~4.5 MB request-body limit with room for the multipart framing. */
const MAX_BYTES = 4 * 1024 * 1024

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('returns.upload', user.id)
  if (limited) return limited

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'NOT_A_FILE' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'NOT_A_FILE' }, { status: 400 })

  const ext = ALLOWED.get(file.type.toLowerCase())
  if (!ext) return NextResponse.json({ error: 'TYPE' }, { status: 415 })
  if (file.size === 0) return NextResponse.json({ error: 'EMPTY' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'TOO_LARGE' }, { status: 413 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!matchesDeclaredType(bytes, file.type)) {
    return NextResponse.json({ error: 'TYPE' }, { status: 415 })
  }

  const path = `returns/${user.id}/${randomUUID()}.${ext}`
  const { error } = await createAdminClient()
    .storage.from('returns')
    .upload(path, bytes, { contentType: file.type, upsert: false })

  if (error) {
    console.error(`[returns] upload failed for ${user.id}: ${error.message}`)
    return NextResponse.json({ error: 'FAILED' }, { status: 502 })
  }

  return NextResponse.json({ path })
}
