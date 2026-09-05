import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import { createProduct, deleteProduct, updateProduct } from '@/lib/server/catalog-store'
import type { Product } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

function revalidateStorefront() {
  revalidatePath('/', 'layout')
  revalidatePath('/api/catalog')
}

/** Rejects a payload before it reaches Postgres, so the admin sees a useful
 *  message instead of a constraint violation. */
function validate(p: Partial<Product>): string | null {
  if (typeof p.id !== 'string' || !p.id.trim()) return 'Missing product id (slug)'
  if (typeof p.group !== 'string' || !p.group) return 'Missing collection'
  if (typeof p.category !== 'string' || !p.category) return 'Missing category'
  if (typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0) {
    return 'Price must be a non-negative number'
  }
  if (p.oldPrice !== undefined && p.oldPrice !== null) {
    if (typeof p.oldPrice !== 'number' || p.oldPrice < 0) return 'Invalid old price'
    // A "discount" that raises the price is always a data-entry mistake.
    if (p.oldPrice <= p.price) return 'Old price must be higher than the current price'
  }
  if (!p.name || typeof p.name !== 'object') return 'Missing product name'
  return null
}

export async function POST(request: NextRequest) {
  let product: Product
  try {
    product = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const problem = validate(product)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  try {
    const created = await createProduct(product)
    revalidateStorefront()
    return NextResponse.json({ product: created }, { status: 201 })
  } catch (e) {
    const message = (e as Error).message
    const duplicate = /duplicate key|23505/i.test(message)
    console.error('[admin/products] create failed:', e)
    return NextResponse.json(
      { error: duplicate ? `A product with id "${product.id}" already exists` : message },
      { status: duplicate ? 409 : 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  let product: Product
  try {
    product = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const problem = validate(product)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  try {
    const updated = await updateProduct(product)
    if (!updated) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    revalidateStorefront()
    return NextResponse.json({ product: updated })
  } catch (e) {
    console.error('[admin/products] update failed:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get('id')
  if (!slug) return NextResponse.json({ error: 'Missing product id' }, { status: 400 })

  try {
    const removed = await deleteProduct(slug)
    if (!removed) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    revalidateStorefront()
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/products] delete failed:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
