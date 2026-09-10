/**
 * The saved looks this browser knows about.
 *
 * Every saved look is a row in public.saved_looks — a guest's included —
 * because a share link has to open for whoever receives it, and a look that
 * lives only in one browser's storage cannot have a link. What is kept HERE
 * is the guest's own list: ids and titles, so the browser remembers what it
 * saved without an account. Nothing personal is stored in either place: a
 * look is product slugs and a line of styling copy.
 *
 * Every access is wrapped: localStorage throws outright in some private modes
 * and when site data is blocked, and a failed "remember" must never stop the
 * save itself from succeeding.
 */

export type SavedLookRef = {
  id: string
  title: string
  productIds: string[]
  savedAt: number
}

const KEY = 'lv.looks.v1'
const MAX = 20

function isRef(value: unknown): value is SavedLookRef {
  const v = value as SavedLookRef
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    Array.isArray(v.productIds) &&
    typeof v.savedAt === 'number'
  )
}

export function readSavedLooks(): SavedLookRef[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter(isRef) : []
  } catch {
    return []
  }
}

/** Newest first, de-duplicated by id, capped so it cannot grow forever. */
export function rememberLook(ref: SavedLookRef): void {
  try {
    const next = [ref, ...readSavedLooks().filter((r) => r.id !== ref.id)].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Remembering is a convenience; the look is saved server-side regardless.
  }
}

/** The public link for a capsule. */
export function capsuleUrl(id: string): string {
  return `${window.location.origin}/stylist/share/${encodeURIComponent(id)}`
}
