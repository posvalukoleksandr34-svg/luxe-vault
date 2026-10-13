import 'server-only'

/**
 * Reads a JSON request body that must be an object.
 *
 * `request.json()` accepts any JSON value, so a body of `null`, `42` or `[]`
 * parses cleanly — and the handler's next line, `body.orderId`, then throws a
 * TypeError that surfaces as a 500. This returns null for malformed JSON AND
 * for anything that is not a plain object, so every caller answers 400:
 *
 *   const body = await readJsonObject<{ orderId?: unknown }>(request)
 *   if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
 *
 * The type parameter describes the fields the handler goes on to validate; it
 * is not a runtime guarantee, so fields should still be typed loosely.
 */
export async function readJsonObject<T extends object = Record<string, unknown>>(
  request: Request,
): Promise<T | null> {
  try {
    const value: unknown = await request.json()
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null
  } catch {
    return null
  }
}

/**
 * readJsonObject with a size limit, for public endpoints that pass the body
 * on to something costly (the chat concierge → a model call).
 *
 * The platform caps a body at a few megabytes; this stops reading at
 * `maxBytes` instead, before parsing, so an oversized request costs a read of
 * `maxBytes` and nothing more. 'too_large' lets the caller answer 413.
 */
export async function readJsonObjectLimited<T extends object = Record<string, unknown>>(
  request: Request,
  maxBytes: number,
): Promise<T | null | 'too_large'> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return 'too_large'
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return 'too_large'
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null
  } catch {
    return null
  }
}
