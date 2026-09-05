import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import {
  createCollection,
  deleteCollection,
  readCatalog,
  updateCollection,
} from '@/lib/server/catalog-store'
import type { LocalizedText } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Drops every Next.js cache entry that could still be holding the old
 * catalogue, so an admin edit is visible on the next request rather than
 * whenever a cache happens to expire.
 *
 * Note this is only half the story in this app: the storefront is a client
 * component that fetches /api/catalog at runtime, so what actually makes an
 * edit appear for customers is that route being `force-dynamic`. These calls
 * matter for any page that is (or later becomes) server-rendered, and cost
 * nothing when there is no cached entry to drop.
 */
function revalidateStorefront() {
  revalidatePath('/', 'layout')
  revalidatePath('/api/catalog')
}

export async function GET() {
  try {
    const { collections, categories } = await readCatalog()
    return NextResponse.json({ collections, categories })
  } catch (e) {
    console.error('[admin/collections] read failed:', e)
    return NextResponse.json({ error: 'Could not load collections' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let body: { slug?: unknown; name?: unknown; image?: unknown; sortOrder?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: 'Slug must be lowercase letters, digits and hyphens (e.g. "new-arrivals")' },
      { status: 400 },
    )
  }

  const name = (body.name ?? {}) as LocalizedText
  if (typeof name !== 'object' || !Object.values(name).some((v) => typeof v === 'string' && v.trim())) {
    return NextResponse.json(
      { error: 'Provide a name in at least one language' },
      { status: 400 },
    )
  }

  try {
    const collection = await createCollection({
      slug,
      name,
      image: typeof body.image === 'string' ? body.image : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    })
    revalidateStorefront()
    return NextResponse.json({ collection }, { status: 201 })
  } catch (e) {
    const message = (e as Error).message
    // 23505 is Postgres' unique_violation — a duplicate slug is the admin's
    // mistake, not a server fault, so it must not read as a 500.
    const duplicate = /duplicate key|23505/i.test(message)
    console.error('[admin/collections] create failed:', e)
    return NextResponse.json(
      { error: duplicate ? `A collection with slug "${slug}" already exists` : message },
      { status: duplicate ? 409 : 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  let body: { slug?: unknown; name?: unknown; image?: unknown; sortOrder?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const slug = typeof body.slug === 'string' ? body.slug : ''
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  try {
    const collection = await updateCollection(slug, {
      name: body.name === undefined ? undefined : (body.name as LocalizedText),
      // null clears the image; undefined leaves it untouched.
      image: body.image === undefined ? undefined : (body.image as string | null),
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    })
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    revalidateStorefront()
    return NextResponse.json({ collection })
  } catch (e) {
    console.error('[admin/collections] update failed:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  try {
    const removed = await deleteCollection(slug)
    if (!removed) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    revalidateStorefront()
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = (e as Error).message
    // ON DELETE RESTRICT fired: the collection still holds products. Tell the
    // admin what to do instead of returning an opaque failure.
    const inUse = /foreign key|23503/i.test(message)
    console.error('[admin/collections] delete failed:', e)
    return NextResponse.json(
      {
        error: inUse
          ? 'This collection still contains products. Move or delete them first.'
          : message,
      },
      { status: inUse ? 409 : 500 },
    )
  }
}
