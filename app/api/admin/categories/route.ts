import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import { createCategory, deleteCategory } from '@/lib/server/catalog-store'
import type { Locale } from '@/lib/types'
import { requireAdmin } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/** Mirrors the categories.slug check constraint in migration 0005. */
const SLUG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/

const LOCALES: Locale[] = ['ru', 'en', 'it', 'fr', 'de']

function revalidateStorefront() {
  revalidatePath('/', 'layout')
  revalidatePath('/api/catalog')
}

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
  let body: { collection?: unknown; slug?: unknown; name?: unknown }
  try {
    body = await request.json()
  } catch {
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

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const slug = new URL(request.url).searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  try {
    const removed = await deleteCategory(slug)
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
