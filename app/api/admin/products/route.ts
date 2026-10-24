import { NextResponse, type NextRequest } from 'next/server'
import { DELIVERY_DAYS_LIMITS, isDeliveryDays } from '@/lib/fulfilment'
import { StockConflictError, createProduct, deleteProduct, updateProduct } from '@/lib/server/catalog-store'
import { describeConflicts } from '@/lib/stock-sync'
import { completeProductCopy, sourceLocale } from '@/lib/server/translate'
import type { Product } from '@/lib/types'
import { requireAdmin } from '@/lib/server/admin-guard'
import { revalidateStorefront } from '@/lib/server/revalidate'
import { readJsonObject } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.


/** Rejects a payload before it reaches Postgres, so the admin sees a useful
 *  message instead of a constraint violation. In Russian, like the console. */
function validate(p: Partial<Product>): string | null {
  if (typeof p.id !== 'string' || !p.id.trim()) return 'Не указан адрес товара (slug)'
  if (typeof p.group !== 'string' || !p.group) return 'Выберите раздел'
  if (typeof p.category !== 'string' || !p.category) return 'Выберите категорию'
  if (typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0) {
    return 'Цена должна быть числом не меньше нуля'
  }
  if (p.oldPrice !== undefined && p.oldPrice !== null) {
    if (typeof p.oldPrice !== 'number' || !Number.isFinite(p.oldPrice) || p.oldPrice < 0) return 'Некорректная старая цена'
    // A "discount" that raises the price is always a data-entry mistake.
    if (p.oldPrice <= p.price) return 'Старая цена должна быть выше текущей'
  }
  if (!p.name || typeof p.name !== 'object') return 'Укажите название товара'
  // At least one language; the rest are completed before saving.
  if (!sourceLocale(p.name)) return 'Укажите название товара'
  for (const v of Object.values(p.name)) {
    if (typeof v === 'string' && v.length > 200) return 'Название длиннее 200 символов'
  }
  if (p.description && typeof p.description === 'object') {
    for (const v of Object.values(p.description)) {
      if (typeof v === 'string' && v.length > 10_000) return 'Описание длиннее 10 000 символов'
    }
  }
  if (p.images !== undefined && (!Array.isArray(p.images) || p.images.length > 30 || p.images.some((u) => typeof u !== 'string'))) {
    return 'Некорректный список фото (не больше 30)'
  }
  if (p.variants !== undefined && (!Array.isArray(p.variants) || p.variants.length > 500)) {
    return 'Слишком много вариантов (не больше 500)'
  }
  // Optional; absent or null means the store default. Anything else must be a
  // window the database's check constraint (0026) would accept.
  if (p.deliveryDays !== undefined && p.deliveryDays !== null && !isDeliveryDays(p.deliveryDays)) {
    return `Срок доставки — целые дни от ${DELIVERY_DAYS_LIMITS.min} до ${DELIVERY_DAYS_LIMITS.max}, «до» не меньше «от»`
  }
  return null
}

/** A new product's address: lower-case letters, digits and single hyphens. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * The product with its name and description in every storefront language:
 * empty languages translated (or, without Gemini, copied from the source) so
 * a visitor in any language reads real text. See completeProductCopy.
 */
async function withCompleteCopy(product: Product): Promise<Product> {
  const { name, description } = await completeProductCopy(product.name, product.description)
  return { ...product, name, description }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const product = await readJsonObject<Product>(request)
  if (!product) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const problem = validate(product)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  if (!SLUG.test(product.id) || product.id.length > 80) {
    return NextResponse.json({ error: 'Адрес товара: латиница, цифры и дефисы, до 80 символов' }, { status: 400 })
  }

  try {
    const created = await createProduct(await withCompleteCopy(product))
    revalidateStorefront()
    return NextResponse.json({ product: created }, { status: 201 })
  } catch (e) {
    const message = (e as Error).message
    const duplicate = /duplicate key|23505/i.test(message)
    console.error('[admin/products] create failed:', e)
    return NextResponse.json(
      { error: duplicate ? `Товар с адресом «${product.id}» уже есть` : message },
      { status: duplicate ? 409 : 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const product = await readJsonObject<Product>(request)
  if (!product) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const problem = validate(product)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  try {
    const updated = await updateProduct(await withCompleteCopy(product))
    if (!updated) return NextResponse.json({ error: 'Товар не найден — возможно, его уже удалили' }, { status: 404 })
    revalidateStorefront()
    return NextResponse.json({ product: updated })
  } catch (e) {
    if (e instanceof StockConflictError) {
      // Stock the admin changed was sold or changed by someone else while the
      // form was open. Nothing of theirs is written over it; they see the
      // live numbers and decide again.
      if (e.partial) revalidateStorefront()
      return NextResponse.json(
        {
          error: e.partial
            ? `Товар сохранён, но остаток не изменён — он поменялся, пока форма была открыта: ${describeConflicts(e.conflicts)}`
            : `Остаток изменился, пока форма была открыта: ${describeConflicts(e.conflicts)}. Ничего не сохранено — проверьте цифры и сохраните ещё раз.`,
          code: 'STOCK_CONFLICT',
          conflicts: e.conflicts,
          partial: e.partial,
        },
        { status: 409 },
      )
    }
    console.error('[admin/products] update failed:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const slug = new URL(request.url).searchParams.get('id')
  if (!slug) return NextResponse.json({ error: 'Не указан товар' }, { status: 400 })

  try {
    const removed = await deleteProduct(slug)
    if (!removed) return NextResponse.json({ error: 'Товар не найден — возможно, его уже удалили' }, { status: 404 })
    revalidateStorefront()
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/products] delete failed:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
