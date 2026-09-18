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
