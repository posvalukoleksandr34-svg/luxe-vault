import { NextResponse, type NextRequest } from 'next/server'
import { createCategory, deleteCategory, updateCategoryImage } from '@/lib/server/catalog-store'
import type { Locale } from '@/lib/types'
import { requireAdmin } from '@/lib/server/admin-guard'
import { revalidateStorefront } from '@/lib/server/revalidate'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/** Mirrors the categories.slug check constraint in migration 0005. */
const SLUG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/

const LOCALES: Locale[] = ['ru', 'en', 'it', 'fr', 'de']


/**
 * Creates a category under a collection.
 *
 * Categories are what the storefront filters, the category routes and the
 * product form's picker are built from, and all of those read them from the
 * database — so a category created here appears everywhere without a deploy.
 *
 * Body: { collection: string, slug: string, name: { ru, en?, it?, fr?, de? } }
 * A language left empty falls back to Russian on the storefront.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const body = await readJsonObject<{ collection?: unknown; slug?: unknown; name?: unknown }>(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const collection = typeof body.collection === 'string' ? body.collection.trim() : ''
  if (!collection) return NextResponse.json({ error: 'Missing collection' }, { status: 400 })

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: 'Slug must be lowercase letters and digits, joined by underscores (e.g. "sunglasses")' },
      { status: 400 },
    )
  }

  // Only the five storefront languages, trimmed; empty ones are left out so
  // the storefront's fallback to Russian applies instead of a blank label.
  const raw = (body.name && typeof body.name === 'object' ? body.name : {}) as Record<string, unknown>
  const name: Partial<Record<Locale, string>> = {}
  for (const locale of LOCALES) {
    const value = raw[locale]
    if (typeof value === 'string' && value.trim()) name[locale] = value.trim()
  }
  if (!name.ru) {
    return NextResponse.json({ error: 'The Russian name is required' }, { status: 400 })
  }

  try {
    const category = await createCategory({ collectionSlug: collection, slug, name })
    revalidateStorefront()
    return NextResponse.json({ category }, { status: 201 })
  } catch (e) {
    const message = (e as Error).message
    const duplicate = /duplicate key|23505/i.test(message)
    console.error('[admin/categories] create failed:', e)
    return NextResponse.json(
      { error: duplicate ? `A category with slug "${slug}" already exists` : message },
      { status: duplicate ? 409 : /Unknown collection/.test(message) ? 400 : 500 },
    )
  }
}

/**
 * Sets or clears a subcategory's cover photograph (the card on the department
 * page). Body: { id: string, image: string | null } — by id, because a slug is
 * unique only within its department.
 *
 * Accepted: an https:// address, a path on this site, or our own Storage's
 * public URL (http on a local Supabase). The admin console uploads to Storage
 * first (/api/admin/uploads) and sends the resulting URL; the database's check
 * (0054) refuses anything that is not an address at all (a base64 blob,
 * javascript:).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Our own Storage, whatever its scheme: a local Supabase is plain http. */
const STORAGE_PREFIX = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')}/storage/v1/object/public/`

function acceptableImage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) return false
  if (value.startsWith('https://')) return true
  if (value.startsWith('/') && !value.startsWith('//')) return true
  return STORAGE_PREFIX.length > '/storage/v1/object/public/'.length && value.startsWith(STORAGE_PREFIX)
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const body = await readJsonObject<{ id?: unknown; image?: unknown }>(request)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  const image = body.image === null ? null : acceptableImage(body.image) ? body.image : undefined
  if (image === undefined) {
    return NextResponse.json({ error: 'The image must be an https:// address (upload it first) or null' }, { status: 400 })
  }

  try {
    const category = await updateCategoryImage(id, image)
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    revalidateStorefront()
    return NextResponse.json({ category })
  } catch (e) {
    const message = (e as Error).message
    console.error('[admin/categories] image update failed:', e)
    return NextResponse.json({ error: message }, { status: /0054/.test(message) ? 503 : 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const slug = params.get('slug')
  const collection = params.get('collection')
  if (!slug || !collection) return NextResponse.json({ error: 'Missing slug or collection' }, { status: 400 })

  try {
    const removed = await deleteCategory(slug, collection)
    if (!removed) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    revalidateStorefront()
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = (e as Error).message
    // products.category_id is ON DELETE RESTRICT: the category still holds
    // products. Say what to do rather than returning an opaque failure.
    const inUse = /foreign key|23503/i.test(message)
    console.error('[admin/categories] delete failed:', e)
    return NextResponse.json(
      { error: inUse ? 'This category still contains products. Move or delete them first.' : message },
      { status: inUse ? 409 : 500 },
    )
  }
}
