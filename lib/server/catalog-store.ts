// Server-only persistence for the catalogue: collections, categories and
// products. Backed by Postgres (Supabase).
//
// Replaces lib/data.ts + localStorage. The old arrangement wrote products to
// the admin's own browser storage, which no customer's browser could ever
// read — this module is what makes an admin edit actually reach the shop.
//
// Naming note, mirroring orders-store.ts: at the application level a product's
// `id` stays its human-readable slug ('p-hoodie-noir'), which is what
// order_items.product_id and reviews.product_id already store. The uuid
// primary key is internal. Same for collections/categories, which the app
// refers to by slug throughout.
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  Category,
  Collection,
  Color,
  LocalizedText,
  Product,
  Variant,
  SizeMeasurement,
  StatusKey,
} from '@/lib/types'

const COLLECTION_SELECT = 'id, slug, name, image_url, sort_order'
const CATEGORY_SELECT = 'id, collection_id, slug, name, sort_order'
const PRODUCT_BASE_SELECT = `
  id, slug, name, description, price, old_price, image, images, sizes,
  colors, statuses, is_new, limited, size_chart, specs,
  collection:collections ( slug ),
  category:categories ( slug )
`

const PRODUCT_SELECT = `${PRODUCT_BASE_SELECT},
  variants:product_variants ( size, color, stock, low_stock_at, sku )
`

const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : parseFloat(v)

type Ref = { slug: string } | { slug: string }[] | null

/** PostgREST returns an embedded one-to-one as an object, but some versions
 *  return a single-element array. Accept both rather than crash on one. */
const refSlug = (ref: Ref): string =>
  Array.isArray(ref) ? (ref[0]?.slug ?? '') : (ref?.slug ?? '')

function rowToCollection(row: Record<string, unknown>): Collection {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: (row.name ?? {}) as LocalizedText,
    image: (row.image_url as string | null) ?? undefined,
    sortOrder: (row.sort_order as number) ?? 0,
  }
}

type VariantRow = {
  size: string
  color: string
  stock: number | string
  low_stock_at: number | string
  sku: string | null
}

function rowToProduct(row: Record<string, unknown>): Product {
  const variants: Variant[] = ((row.variants as VariantRow[] | null) ?? []).map((v) => ({
    size: v.size,
    color: v.color,
    stock: Math.max(0, Math.trunc(num(v.stock))),
    lowStockAt: Math.max(0, Math.trunc(num(v.low_stock_at))),
    sku: v.sku ?? undefined,
  }))

  const rawColors = ((row.colors as Color[] | null) ?? []) as Color[]

  /**
   * Colour-level stock is the sum of that colour's sizes.
   *
   * The colour swatches and the sold-out styling already read `Color.stock`,
   * so deriving it here keeps every one of those call sites working unchanged
   * while the real numbers move to the variants table. Left undefined when the
   * product is untracked, because undefined and zero mean different things to
   * the components downstream.
   */
  const colors: Color[] = variants.length
    ? rawColors.map((c) => ({
        ...c,
        stock: variants
          .filter((v) => v.color === c.name)
          .reduce((sum, v) => sum + v.stock, 0),
      }))
    : rawColors

  return {
    id: row.slug as string,
    variants: variants.length ? variants : undefined,
    name: (row.name ?? {}) as LocalizedText,
    description: (row.description ?? {}) as LocalizedText,
    group: refSlug(row.collection as Ref),
    category: refSlug(row.category as Ref),
    price: num(row.price as string),
    oldPrice: row.old_price == null ? undefined : num(row.old_price as string),
    image: (row.image as string | null) ?? '',
    images: ((row.images as string[] | null) ?? []).length
      ? (row.images as string[])
      : undefined,
    sizes: (row.sizes as string[] | null) ?? [],
    colors,
    statuses: ((row.statuses as string[] | null) ?? []) as StatusKey[],
    isNew: Boolean(row.is_new),
    limited: Boolean(row.limited),
    sizeChart: (row.size_chart as SizeMeasurement[] | null) ?? undefined,
    specs: ((row.specs as { label: string; value: string }[] | null) ?? []).filter((s) => s?.label && s?.value),
  }
}

export type Catalog = {
  collections: Collection[]
  categories: Category[]
  products: Product[]
}

/**
 * Products, with variant stock when the inventory migration has been applied.
 *
 * The embedded `product_variants` join fails with PGRST200 ("could not find a
 * relationship") on a database still on 0011. Retrying without it means a
 * deploy that lands before the migration serves an untracked catalogue rather
 * than taking the entire shop down — every product simply reads as it did
 * before inventory existed.
 *
 * The retry can be deleted once 0012 is applied everywhere.
 */
/**
 * The product select this database can actually satisfy, probed once.
 *
 * Columns and relations arrive with migrations, and PostgREST rejects the
 * whole SELECT when one of them is unknown — so naming them unconditionally
 * makes a deploy that lands ahead of its migration take the shop down. This
 * asks the database what it has, once, and caches the answer.
 *
 * A retry-on-error version of this lived only inside readCatalog, which meant
 * getProductBySlug — the product page — still asked for everything and threw.
 * Resolving in one place is what stops the two drifting again.
 *
 * Both branches can be deleted once 0012 and 0018 are applied everywhere.
 */
let productSelectCache: string | null = null

async function resolveProductSelect(): Promise<string> {
  if (productSelectCache) return productSelectCache

  const supabase = createAdminClient()

  const [variants, specs] = await Promise.all([
    supabase.from('product_variants').select('id').limit(1),
    supabase.from('products').select('specs').limit(1),
  ])

  let select = variants.error ? PRODUCT_BASE_SELECT : PRODUCT_SELECT

  if (variants.error) {
    console.error(
      '[catalog] product_variants is missing — stock is NOT being tracked. ' +
        'Apply supabase/migrations/0012_inventory.sql.',
    )
  }
  if (specs.error) {
    console.error('[catalog] products.specs is missing. Apply 0018_product_specs.sql.')
    select = select.replace(' specs,', '')
  }

  productSelectCache = select
  return select
}

async function readProducts(supabase: ReturnType<typeof createAdminClient>) {
  return supabase
    .from('products')
    .select(await resolveProductSelect())
    .order('created_at', { ascending: false })
}

/** One round trip for the whole catalogue — it is small and always needed
 *  together, so three queries beat N+1 and beat three separate requests. */
export async function readCatalog(): Promise<Catalog> {
  const supabase = createAdminClient()

  const [collectionsRes, categoriesRes, productsRes] = await Promise.all([
    supabase.from('collections').select(COLLECTION_SELECT).order('sort_order'),
    supabase.from('categories').select(CATEGORY_SELECT).order('sort_order'),
    readProducts(supabase),
  ])

  if (collectionsRes.error) throw new Error(`Failed to read collections: ${collectionsRes.error.message}`)
  if (categoriesRes.error) throw new Error(`Failed to read categories: ${categoriesRes.error.message}`)
  if (productsRes.error) throw new Error(`Failed to read products: ${productsRes.error.message}`)

  const collections = (collectionsRes.data ?? []).map(rowToCollection)
  const byId = new Map(collections.map((c) => [c.id, c.slug]))

  const categories: Category[] = (categoriesRes.data ?? []).map((row) => ({
    id: row.id as string,
    collectionId: row.collection_id as string,
    collectionSlug: byId.get(row.collection_id as string) ?? '',
    slug: row.slug as string,
    name: (row.name ?? {}) as LocalizedText,
    sortOrder: (row.sort_order as number) ?? 0,
  }))

  // The select string is chosen at runtime by readProducts(), which costs
  // PostgREST's compile-time row typing. rowToProduct reads every field
  // defensively, so the cast is safe.
  const productRows = (productsRes.data ?? []) as unknown as Record<string, unknown>[]

  return { collections, categories, products: productRows.map(rowToProduct) }
}

// ------------------------------------------------------------ collections ----

export async function createCollection(input: {
  slug: string
  name: LocalizedText
  image?: string
  sortOrder?: number
}): Promise<Collection> {
  const { data, error } = await createAdminClient()
    .from('collections')
    .insert({
      slug: input.slug,
      name: input.name,
      image_url: input.image ?? null,
      sort_order: input.sortOrder ?? 0,
    })
    .select(COLLECTION_SELECT)
    .single()

  if (error) throw new Error(`Failed to create collection: ${error.message}`)
  return rowToCollection(data)
}

export async function updateCollection(
  slug: string,
  patch: { name?: LocalizedText; image?: string | null; sortOrder?: number },
): Promise<Collection | null> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.image !== undefined) row.image_url = patch.image
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder

  const { data, error } = await createAdminClient()
    .from('collections')
    .update(row)
    .eq('slug', slug)
    .select(COLLECTION_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to update collection: ${error.message}`)
  return data ? rowToCollection(data) : null
}

/**
 * Deletes a collection. The FK from products is ON DELETE RESTRICT, so a
 * collection that still holds products fails here rather than silently taking
 * the catalogue with it — that error is surfaced to the admin as a 409.
 */
export async function deleteCollection(slug: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('collections')
    .delete()
    .eq('slug', slug)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to delete collection: ${error.message}`)
  return Boolean(data)
}

/** Resolves the uuids a product row needs from the slugs the app speaks. */
async function resolveRefs(groupSlug: string, categorySlug: string) {
  const supabase = createAdminClient()
  const [c, cat] = await Promise.all([
    supabase.from('collections').select('id').eq('slug', groupSlug).maybeSingle(),
    supabase.from('categories').select('id, collection_id').eq('slug', categorySlug).maybeSingle(),
  ])
  if (c.error || !c.data) throw new Error(`Unknown collection "${groupSlug}"`)
  if (cat.error || !cat.data) throw new Error(`Unknown category "${categorySlug}"`)
  if (cat.data.collection_id !== c.data.id) {
    // Rejected here rather than stored: a product filed under a category that
    // belongs to a different collection would vanish from both filters.
    throw new Error(`Category "${categorySlug}" does not belong to "${groupSlug}"`)
  }
  return { collectionId: c.data.id as string, categoryId: cat.data.id as string }
}

// --------------------------------------------------------------- products ----

function productToRow(product: Product, collectionId: string, categoryId: string) {
  return {
    slug: product.id,
    name: product.name,
    description: product.description,
    collection_id: collectionId,
    category_id: categoryId,
    price: product.price,
    old_price: product.oldPrice ?? null,
    image: product.image || null,
    images: product.images ?? [],
    sizes: product.sizes ?? [],
    colors: product.colors ?? [],
    statuses: product.statuses ?? [],
    is_new: Boolean(product.isNew),
    limited: Boolean(product.limited),
    size_chart: product.sizeChart ?? null,
    specs: (product.specs ?? []).filter((s) => s.label?.trim() && s.value?.trim()),
  }
}

/**
 * Writes the product's variant rows, adding, updating and removing as needed.
 *
 * Deliberately NOT a delete-then-insert. Deleting every row and re-creating it
 * would take each variant's stock to zero and back on every save, and any
 * checkout landing in that window would be told the item is sold out — an
 * admin editing a description must not be able to reject a customer's order.
 *
 * Passing `undefined` for variants leaves the table alone entirely, so callers
 * that know nothing about stock cannot wipe it.
 */
async function syncVariants(productUuid: string, variants: Variant[] | undefined) {
  if (!variants) return

  const supabase = createAdminClient()

  const rows = variants
    .filter((v) => v.size.trim() && v.color.trim())
    .map((v) => ({
      product_id: productUuid,
      size: v.size.trim(),
      color: v.color.trim(),
      stock: Math.max(0, Math.trunc(v.stock)),
      low_stock_at: Math.max(0, Math.trunc(v.lowStockAt ?? 5)),
      sku: v.sku?.trim() || null,
    }))

  if (rows.length > 0) {
    const { error } = await supabase
      .from('product_variants')
      .upsert(rows, { onConflict: 'product_id,size,color' })
    if (error) throw new Error(`Failed to save variants: ${error.message}`)
  }

  // Drop combinations the admin removed. Done after the upsert so a variant
  // that was only renamed is never briefly absent.
  const keep = new Set(rows.map((r) => `${r.size} ${r.color}`))
  const { data: existing, error: readError } = await supabase
    .from('product_variants')
    .select('id, size, color')
    .eq('product_id', productUuid)

  if (readError) throw new Error(`Failed to read variants: ${readError.message}`)

  const stale = (existing ?? [])
    .filter((r) => !keep.has(`${r.size} ${r.color}`))
    .map((r) => r.id as string)

  if (stale.length > 0) {
    const { error } = await supabase.from('product_variants').delete().in('id', stale)
    if (error) throw new Error(`Failed to remove variants: ${error.message}`)
  }
}

export async function createProduct(product: Product): Promise<Product> {
  const { collectionId, categoryId } = await resolveRefs(product.group, product.category)
  const { data, error } = await createAdminClient()
    .from('products')
    .insert(productToRow(product, collectionId, categoryId))
    .select(await resolveProductSelect())
    .single()

  if (error) throw new Error(`Failed to create product: ${error.message}`)

  await syncVariants((data as unknown as { id: string }).id, product.variants)

  // Re-read so the returned product carries the variants that were just
  // written, rather than the empty set the insert saw.
  return (await getProductBySlug(product.id)) ?? rowToProduct(data as unknown as Record<string, unknown>)
}

export async function updateProduct(product: Product): Promise<Product | null> {
  const { collectionId, categoryId } = await resolveRefs(product.group, product.category)
  const { data, error } = await createAdminClient()
    .from('products')
    .update(productToRow(product, collectionId, categoryId))
    .eq('slug', product.id)
    .select(await resolveProductSelect())
    .maybeSingle()

  if (error) throw new Error(`Failed to update product: ${error.message}`)
  if (!data) return null

  await syncVariants((data as unknown as { id: string }).id, product.variants)

  return (await getProductBySlug(product.id)) ?? rowToProduct(data as unknown as Record<string, unknown>)
}

export async function deleteProduct(slug: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('products')
    .delete()
    .eq('slug', slug)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to delete product: ${error.message}`)
  return Boolean(data)
}

/**
 * One product by its slug — the value stored in `products.slug`, which is also
 * `Product.id` in the app and the segment in /product/[slug].
 *
 * A single-row query rather than filtering readCatalog(): a product page is
 * rendered per request per product, and pulling the whole catalogue to throw
 * away all but one row makes every product page pay for every other product.
 *
 * Returns null for an unknown slug so the caller can render notFound() rather
 * than a 500 — a mistyped URL is a 404, not a server error.
 */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await createAdminClient()
    .from('products')
    .select(await resolveProductSelect())
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw new Error(`Failed to read product: ${error.message}`)
  return data ? rowToProduct(data as unknown as Record<string, unknown>) : null
}

/**
 * Every product slug, for the sitemap.
 *
 * Selects only the two columns it needs: a sitemap of a large catalogue would
 * otherwise transfer every description and image array to emit a list of URLs.
 * `updated_at` becomes each entry's <lastmod>, which is the honest signal —
 * using the build time would tell Google every product changed on every deploy
 * and teach it to ignore the field.
 */
export async function listProductSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  const { data, error } = await createAdminClient()
    .from('products')
    .select('slug, updated_at')
    .order('updated_at', { ascending: false })

  if (error) throw new Error(`Failed to list product slugs: ${error.message}`)
  return (data ?? []).map((row) => ({
    slug: row.slug as string,
    updatedAt: new Date((row.updated_at as string) ?? Date.now()),
  }))
}
