import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { SUPABASE_URL } from '@/lib/supabase/env'

/**
 * Product and collection imagery, held in Supabase Storage.
 *
 * WHY THIS FILE EXISTS
 *
 * Images used to be read in the browser with `FileReader.readAsDataURL` and
 * written straight into the `image` column as a base64 data: URI. It worked,
 * and it needed no infrastructure, which is why it was chosen — but it puts
 * the bytes of every photograph inside every HTML response that mentions the
 * product. Measured before this change: one product image was 401,351
 * characters, and the three-product homepage was 2.13 MB of HTML that stayed
 * at 1.5 MB after gzip, because base64 is already high-entropy and does not
 * compress. Each image was serialised twice — once into the markup and once
 * into the RSC flight payload.
 *
 * The cost of that is not only size. A data: URI cannot be cached by the
 * browser, cannot be served by a CDN, cannot be lazily loaded, cannot be
 * resized per viewport, and is re-sent in full on every single navigation.
 *
 * Stored as a file behind a URL, the same image is fetched once, cached
 * forever (the object name contains a random id, so a replacement is a new
 * URL and there is nothing to invalidate), and can pass through the Next
 * image optimiser to be resized and re-encoded as WebP or AVIF.
 *
 * WHY UPLOADS GO THROUGH THE SERVER
 *
 * The browser could upload to Storage directly, but only by holding a key
 * that can write to the bucket. Routing through /api/admin/uploads means the
 * only credential involved is the service-role key, which never leaves the
 * server, and the admin session cookie already checked by middleware.ts is
 * what authorises the write.
 */

const BUCKET = 'product-images'

/** Mirrors the bucket's own `file_size_limit`, so the caller gets a useful
 *  message instead of an opaque 413 from Storage. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Mirrors the bucket's `allowed_mime_types`. */
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
  ['image/gif', 'gif'],
])

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

/** Public base for everything in the bucket. Also used by next.config.js to
 *  authorise the optimiser, and by isStoredImage() below. */
export const STORAGE_PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`

/** True for a URL this module produced. Used by the backfill to skip rows that
 *  have already been migrated, which is what makes it safe to re-run. */
export function isStoredImage(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(STORAGE_PUBLIC_PREFIX)
}

export function isDataUri(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith('data:image/')
}

/**
 * Decode a `data:image/...;base64,...` string.
 *
 * Only needed by the one-off backfill, but it lives here so the data-URI
 * format is understood in exactly one place.
 */
export function decodeDataUri(
  uri: string,
): { bytes: Buffer; contentType: string } | null {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(uri)
  if (!match) return null
  const contentType = match[1].toLowerCase()
  if (!ALLOWED.has(contentType)) return null
  try {
    return { bytes: Buffer.from(match[2], 'base64'), contentType }
  } catch {
    return null
  }
}

/**
 * Store one image and return its public URL.
 *
 * The object name is random rather than derived from the original filename:
 * two products called "front.jpg" must not collide, and a predictable name
 * would let anyone enumerate the bucket. `upsert: false` makes a collision an
 * error rather than a silent overwrite.
 */
export async function uploadImage(
  bytes: ArrayBuffer | Buffer,
  contentType: string,
  folder: 'products' | 'collections' = 'products',
): Promise<UploadResult> {
  const ext = ALLOWED.get(contentType.toLowerCase())
  if (!ext) {
    return { ok: false, error: `Unsupported image type: ${contentType}` }
  }

  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Image is ${(body.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    }
  }
  if (body.byteLength === 0) {
    return { ok: false, error: 'Image is empty.' }
  }

  const name = `${folder}/${Date.now().toString(36)}-${randomId(10)}.${ext}`

  const supabase = createAdminClient()
  const { error } = await supabase.storage.from(BUCKET).upload(name, body, {
    contentType,
    upsert: false,
    // A year, immutable: the name is unique per upload, so the bytes behind a
    // given URL never change and the browser never needs to revalidate.
    cacheControl: '31536000',
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, url: `${STORAGE_PUBLIC_PREFIX}${name}` }
}

function randomId(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  // Indexed rather than iterated: the project targets ES5, where for..of over
  // a typed array needs --downlevelIteration.
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}
